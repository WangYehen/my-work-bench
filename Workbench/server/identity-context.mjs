import { randomUUID } from "node:crypto";
import { openLocalFirstDatabase } from "./db/local-first.mjs";

export function createIdentityContext({ dbPath, now = () => new Date() }) {
  const db = openLocalFirstDatabase(dbPath);
  const stamp = () => now().toISOString();
  const identityId = (userId) => `dingtalk:${String(userId)}`;
  const departmentId = (providerId) => `dingtalk-dept:${String(providerId)}`;

  // 写入或更新单个钉钉成员档案（登录身份或组织成员），必要时补建主管占位身份
  function upsertIdentityProfile(profile, { includeManager = true } = {}) {
    if (!profile?.id) return null;
    const id = identityId(profile.dingtalkUserId || profile.id);
    db.prepare(`INSERT INTO identities(id,provider,provider_account_id,display_name,avatar_url,profile_json,last_synced_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(provider,provider_account_id) DO UPDATE SET display_name=excluded.display_name,avatar_url=excluded.avatar_url,profile_json=excluded.profile_json,last_synced_at=excluded.last_synced_at,updated_at=excluded.updated_at`)
      .run(id, "dingtalk", String(profile.dingtalkUserId || profile.id), profile.displayName || null, profile.avatarUrl || null, JSON.stringify(profile), stamp(), stamp(), stamp());
    if (includeManager && profile.managerUserId) {
      db.prepare("INSERT OR IGNORE INTO identities(id,provider,provider_account_id,created_at,updated_at) VALUES(?,?,?,?,?)")
        .run(identityId(profile.managerUserId), "dingtalk", String(profile.managerUserId), stamp(), stamp());
    }
    return id;
  }

  // 写入部门（含父部门占位），按 provider_id 幂等；钉钉虚拟根部门 parent_id=1 视为无父
  function upsertDepartment(providerId, name = null, parentProviderId = null, depth = 0) {
    const key = String(providerId);
    const id = departmentId(key);
    let parentId = null;
    if (parentProviderId && String(parentProviderId) !== "1" && depth < 30) {
      const parentKey = String(parentProviderId);
      // 父部门缺失时先插入占位，避免 parent_id 外键约束失败（真实企业树可能引用未收录部门）
      if (parentKey !== key && !db.prepare("SELECT id FROM departments WHERE id=?").get(departmentId(parentKey))) upsertDepartment(parentKey, null, null, depth + 1);
      parentId = departmentId(parentKey);
    }
    // name 为可选信息；NULL 时用空字符串占位以满足 NOT NULL（ON CONFLICT 只处理唯一冲突，
    // 候选行约束仍会先检查），DO UPDATE 时再按 NULLIF 保留旧名。
    db.prepare(`INSERT INTO departments(id,provider_id,name,parent_id,updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET provider_id=excluded.provider_id,name=CASE WHEN NULLIF(excluded.name,'') IS NULL THEN name ELSE excluded.name END, parent_id=COALESCE(excluded.parent_id,parent_id), updated_at=excluded.updated_at`)
      .run(id, key, name ?? "", parentId, stamp());
    return id;
  }

  // 登录时轻量同步当前身份（不扫描组织树）
  function sync(profile) {
    if (!profile?.id) return null;
    const id = upsertIdentityProfile(profile);
    const departmentIds = Array.isArray(profile.departmentIds) ? profile.departmentIds : [];
    const managerId = profile.managerUserId ? identityId(profile.managerUserId) : null;
    let departmentInternalId = null;
    if (departmentIds[0]) departmentInternalId = upsertDepartment(departmentIds[0], profile.departmentName || null);
    db.prepare(`INSERT INTO org_members(identity_id,manager_identity_id,department_id,role,status,updated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(identity_id) DO UPDATE SET manager_identity_id=excluded.manager_identity_id,department_id=excluded.department_id,status=excluded.status,updated_at=excluded.updated_at`)
      .run(id, managerId, departmentInternalId, "member", "active", stamp());
    if (Array.isArray(profile.organizationMembers)) for (const member of profile.organizationMembers) if (String(member.id) !== String(profile.dingtalkUserId || profile.id)) sync(member);
    return context(id, profile);
  }

  // 后台组织同步：仅保留递归下属（管理链最终到当前主管），写入多部门归属并对本轮不再出现的成员做失效
  function applyOrganization(profile) {
    const rootUserId = String(profile.dingtalkUserId || profile.id || "");
    const members = Array.isArray(profile.organizationMembers) ? profile.organizationMembers : [];
    const byId = new Map();
    for (const member of members) if (member?.id) byId.set(String(member.id), member);
    const rootId = identityId(rootUserId);

    // 判断成员是否为 root 的递归下属：沿 managerUserId 链最终到 root
    const isDescendant = (id) => {
      const seen = new Set([id]);
      let current = String(byId.get(id)?.managerUserId || "");
      while (current && current !== rootUserId && !seen.has(current)) {
        seen.add(current);
        current = String(byId.get(current)?.managerUserId || "");
      }
      return current === rootUserId;
    };
    const authorizedIds = new Set();
    for (const member of byId.values()) {
      if (String(member.id) === rootUserId) continue;
      if (member.managerUserId && isDescendant(String(member.id))) authorizedIds.add(String(member.id));
    }

    // 收集本轮扫描到的部门（含无成员部门与父子关系）
    const departmentsByProvider = new Map();
    for (const dept of Array.isArray(profile.departments) ? profile.departments : []) departmentsByProvider.set(String(dept.id), dept);

    const stampValue = stamp();
    const tx = db.transaction(() => {
      upsertIdentityProfile(profile);
      for (const key of departmentsByProvider.keys()) {
        const dept = departmentsByProvider.get(key);
        upsertDepartment(key, dept.name || null, dept.parentId || null);
      }
      const insertMember = db.prepare(`INSERT INTO org_members(identity_id,manager_identity_id,role,status,authorized_by_identity_id,updated_at)
        VALUES(?,?,?,?,?,?)
        ON CONFLICT(identity_id) DO UPDATE SET manager_identity_id=excluded.manager_identity_id,role=excluded.role,status=excluded.status,authorized_by_identity_id=excluded.authorized_by_identity_id,updated_at=excluded.updated_at`);
      const insertMemberDept = db.prepare(`INSERT INTO org_member_departments(identity_id,department_id,updated_at) VALUES(?,?,?)
        ON CONFLICT(identity_id,department_id) DO UPDATE SET updated_at=excluded.updated_at`);
      const insertPlaceholder = db.prepare("INSERT OR IGNORE INTO identities(id,provider,provider_account_id,created_at,updated_at) VALUES(?,?,?,?,?)");

      for (const memberId of authorizedIds) {
        const member = byId.get(memberId);
        const memberIdentityId = identityId(memberId);
        const managerUserId = String(member.managerUserId || "");
        const managerIdentityId = managerUserId ? identityId(managerUserId) : null;
        insertPlaceholder.run(memberIdentityId, "dingtalk", memberId, stampValue, stampValue);
        if (managerIdentityId) insertPlaceholder.run(managerIdentityId, "dingtalk", managerUserId, stampValue, stampValue);
        upsertIdentityProfile(member, { includeManager: false });
        insertMember.run(memberIdentityId, managerIdentityId, "member", "active", rootId, stampValue);
        const currentDeptIds = new Set();
        for (const providerDeptId of Array.isArray(member.departmentIds) ? member.departmentIds : []) {
          const deptInternalId = upsertDepartment(providerDeptId);
          currentDeptIds.add(deptInternalId);
          insertMemberDept.run(memberIdentityId, deptInternalId, stampValue);
        }
        // 失效：删除本轮之外遗留的旧部门关联
        const oldDepts = db.prepare("SELECT department_id FROM org_member_departments WHERE identity_id = ?").all(memberIdentityId);
        for (const old of oldDepts) if (!currentDeptIds.has(old.department_id)) db.prepare("DELETE FROM org_member_departments WHERE identity_id = ? AND department_id = ?").run(memberIdentityId, old.department_id);
      }

      // 失效：本主管曾收录、本轮不再可见的成员
      const staleRows = db.prepare("SELECT identity_id FROM org_members WHERE authorized_by_identity_id = ? AND status = 'active'").all(rootId);
      for (const stale of staleRows) {
        if (!authorizedIds.has(String(stale.identity_id).replace(/^dingtalk:/, ""))) {
          db.prepare("UPDATE org_members SET status='disabled', updated_at=? WHERE identity_id = ?").run(stampValue, stale.identity_id);
          db.prepare("DELETE FROM org_member_departments WHERE identity_id = ?").run(stale.identity_id);
        }
      }
    });
    tx();
    return { departmentCount: departmentsByProvider.size, memberCount: authorizedIds.size };
  }

  function descendants(id) {
    const rows = db.prepare("SELECT identity_id,manager_identity_id FROM org_members WHERE status='active'").all();
    const children = new Map();
    for (const row of rows) {
      const list = children.get(row.manager_identity_id) || [];
      list.push(row.identity_id);
      children.set(row.manager_identity_id, list);
    }
    const result = [];
    const queue = [...(children.get(id) || [])];
    while (queue.length) {
      const child = queue.shift();
      if (result.includes(child)) continue;
      result.push(child);
      queue.push(...(children.get(child) || []));
    }
    return result;
  }
  function context(id, profile = null) {
    const children = descendants(id);
    // 组织图是否已入库：存在 authorized_by 授权记录即视为已同步（重启后同样成立）
    const hasAuthorizedOrg = Boolean(db.prepare("SELECT 1 FROM org_members WHERE authorized_by_identity_id=? LIMIT 1").get(id));
    return { id, profile, organizationSynced: hasAuthorizedOrg || profile?.organizationSynced === true, managerIdentityId: db.prepare("SELECT manager_identity_id FROM org_members WHERE identity_id=?").get(id)?.manager_identity_id || null, subordinateCount: children.length, role: children.length ? "manager" : "member", canViewTeamReports: children.length > 0, visibleIdentityIds: [id, ...children] };
  }
  function current(profile) { if (!profile?.id) return null; return sync(profile); }
  function clearUnownedWorkItems() { return db.prepare("DELETE FROM work_items WHERE owner_identity_id IS NULL").run().changes; }
  function saveReports(reports = []) {
    const nowValue = stamp(); let saved = 0;
    const insertIdentity = db.prepare("INSERT OR IGNORE INTO identities(id,provider,provider_account_id,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)");
    const upsert = db.prepare("INSERT INTO daily_reports(id,owner_identity_id,report_date,source,source_report_id,sync_status,summary,completed_snapshot_json,next_actions_snapshot_json,raw_payload_ref,submitted_at,synced_at,source_updated_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_identity_id,report_date) DO UPDATE SET source='dingtalk',source_report_id=excluded.source_report_id,sync_status='synced',summary=excluded.summary,completed_snapshot_json=excluded.completed_snapshot_json,next_actions_snapshot_json=excluded.next_actions_snapshot_json,raw_payload_ref=excluded.raw_payload_ref,submitted_at=excluded.submitted_at,synced_at=excluded.synced_at,source_updated_at=excluded.source_updated_at,updated_at=excluded.updated_at");
    for (const report of reports) {
      if (!report?.creatorId || !report?.reportDate) continue;
      const ownerIdentityId = identityId(report.creatorId);
      insertIdentity.run(ownerIdentityId, "dingtalk", String(report.creatorId), report.creatorName || null, nowValue, nowValue);
      upsert.run(randomUUID(), ownerIdentityId, report.reportDate, "dingtalk", report.reportId || null, "synced", report.remark || report.completedItems || null, JSON.stringify(report.completedItems || ""), JSON.stringify(report.nextActions || ""), JSON.stringify({ blockers: report.blockers || "", cooperationNeeds: report.cooperationNeeds || "", images: report.images || "", attachments: report.attachments || "", templateName: report.templateName || "", remark: report.remark || "" }), report.createTime ? new Date(report.createTime).toISOString() : null, nowValue, report.modifiedTime ? new Date(report.modifiedTime).toISOString() : null, nowValue, nowValue);
      saved += 1;
    }
    return saved;
  }
  function ownReports(identityId, { from = "1000-01-01", to = "9999-12-31" } = {}) {
    const account = String(identityId || ""); if (!account) throw Object.assign(new Error("请先连接钉钉账号。"), { code: "PRIVACY_LOCKED" });
    return db.prepare("SELECT id,report_date AS reportDate,summary,completed_snapshot_json AS completedItems,next_actions_snapshot_json AS nextActions,raw_payload_ref AS rawPayload,submitted_at AS submittedAt,source_report_id AS dingtalkReportId FROM daily_reports WHERE owner_identity_id=? AND report_date BETWEEN ? AND ? ORDER BY report_date ASC").all(account, String(from), String(to)).map((row) => ({ ...row, completedItems: safeJson(row.completedItems), nextActions: safeJson(row.nextActions), ...safeJson(row.rawPayload) }));
  }
  function ownReport(identityId, date) { return ownReports(identityId, { from: date, to: date })[0] || null; }
  function dashboard(context, { date, departmentId = "", member = "" } = {}) {
    if (!context?.canViewTeamReports) throw Object.assign(new Error("当前账号没有下属日报查看权限。"), { code: "TEAM_REPORT_FORBIDDEN" });
    const ids = context.visibleIdentityIds.slice(1);
    const reportDate = String(date || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now()));
    const placeholders = ids.map(() => "?").join(",");
    const empty = () => ({ reportDate, generatedAt: stamp(), metrics: { submitted: 0, expected: 0, missing: 0, late: 0 }, members: [], reports: [], departments: [], summary: { blockers: [], decisions: [], nextActions: [] } });
    if (!ids.length) return empty();
    // 可见成员及全部部门归属
    const rows = db.prepare(`SELECT i.id,i.display_name AS displayName,i.avatar_url AS avatarUrl,md.department_id AS departmentId,d.name AS departmentName
      FROM org_members om JOIN identities i ON i.id=om.identity_id
      LEFT JOIN org_member_departments md ON md.identity_id=i.id
      LEFT JOIN departments d ON d.id=md.department_id
      WHERE om.status='active' AND i.id IN (${placeholders})
      ORDER BY i.display_name,d.name`).all(...ids);
    const memberMap = new Map();
    for (const row of rows) {
      let item = memberMap.get(row.id);
      if (!item) { item = { id: row.id, displayName: row.displayName, avatarUrl: row.avatarUrl, departmentIds: [], departmentNames: [] }; memberMap.set(row.id, item); }
      if (row.departmentId && !item.departmentIds.includes(row.departmentId)) { item.departmentIds.push(row.departmentId); item.departmentNames.push(row.departmentName); }
    }
    let members = [...memberMap.values()].map((item) => ({ ...item, departmentName: item.departmentNames[0] || null }));
    if (departmentId) members = members.filter((item) => item.departmentIds.includes(departmentId));
    if (member) members = members.filter((item) => item.id === member);
    const memberIds = members.map((item) => item.id);
    // 可见成员涉及的全部部门（供部门筛选）
    const departments = db.prepare(`SELECT d.id,d.name,COUNT(DISTINCT md.identity_id) AS memberCount
      FROM org_member_departments md JOIN departments d ON d.id=md.department_id
      WHERE md.identity_id IN (${placeholders})
      GROUP BY d.id,d.name ORDER BY d.name`).all(...ids);
    const reportRows = memberIds.length ? db.prepare(`SELECT r.id,r.owner_identity_id AS ownerIdentityId,r.report_date AS reportDate,r.summary,r.completed_snapshot_json AS completedItems,r.next_actions_snapshot_json AS nextActions,r.raw_payload_ref AS rawPayload,r.submitted_at AS submittedAt,i.display_name AS displayName,
      (SELECT group_concat(d.name,' · ') FROM org_member_departments md JOIN departments d ON d.id=md.department_id WHERE md.identity_id=r.owner_identity_id) AS departmentNames
      FROM daily_reports r JOIN identities i ON i.id=r.owner_identity_id
      WHERE r.owner_identity_id IN (${memberIds.map(() => "?").join(",")}) AND r.report_date=? ORDER BY i.display_name`).all(...memberIds, reportDate) : [];
    const byOwner = new Map(reportRows.map((row) => [row.ownerIdentityId, row]));
    const statusMembers = members.map((item) => ({ ...item, status: byOwner.has(item.id) ? "submitted" : "missing", submittedAt: byOwner.get(item.id)?.submittedAt || null }));
    return { reportDate, generatedAt: stamp(), metrics: { submitted: reportRows.length, expected: members.length, missing: statusMembers.filter((item) => item.status === "missing").length, late: 0 }, members: statusMembers, reports: reportRows.map((row) => ({ ...row, completedItems: safeJson(row.completedItems), nextActions: safeJson(row.nextActions), ...safeJson(row.rawPayload) })), departments, summary: { blockers: [], decisions: [], nextActions: [] } };
  }
  return { current, sync, applyOrganization, descendants, dashboard, clearUnownedWorkItems, saveReports, ownReports, ownReport, close: () => db.close(), identityId };
}

function safeJson(value) { try { return JSON.parse(value || "{}"); } catch { return value || ""; } }
