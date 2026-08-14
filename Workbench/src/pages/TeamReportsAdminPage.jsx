import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconCheck, IconChevronRight, IconRefresh } from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { DingTalkSyncStatus } from "../components/DingTalkSyncStatus";
import { loadDingTalkStatus } from "../lib/api";
import { getDailyReportUser, loadTeamDashboard, subscribeDailyReportAuth, syncDingTalkOrganization, syncDingTalkReports } from "../lib/daily-reports";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
const demo = {
  reportDate: today(), generatedAt: new Date().toISOString(), metrics: { submitted: 18, expected: 22, missing: 3, late: 1 },
  members: [
    { id: 1, displayName: "周明", departmentName: "前端开发组", status: "missing" },
    { id: 2, displayName: "孙悦", departmentName: "测试组", status: "missing" },
    { id: 3, displayName: "吴迪", departmentName: "产品组", status: "missing" },
    { id: 4, displayName: "郑凯", departmentName: "运维组", status: "late" },
  ],
  reports: [],
  summary: {
    blockers: [
      { text: "测试环境接口不稳定，导致联调验证受阻", affectedMembers: ["周明", "孙悦", "吴迪", "陈晨", "李娜", "王磊"], departments: ["接口服务组", "前端开发组"] },
      { text: "数据权限方案未最终确认", affectedMembers: ["王敏", "刘洋", "张伟", "赵磊"], departments: ["数据平台组", "业务系统组"] },
      { text: "第三方服务审批未完成，影响接口开通", affectedMembers: ["赵磊", "郑凯", "陈晨"], departments: ["运维组", "集成组"] },
    ],
    decisions: [
      { text: "是否调整用户画像需求交付范围", owner: "刘洋（产品组）", dueAt: "今天 18:00" },
      { text: "是否追加人力支持数据权限优化", owner: "王敏（开发组）", dueAt: "明天 10:00" },
      { text: "是否确定 A 供应商为长期合作方", owner: "赵磊（采购组）", dueAt: "明天 14:00" },
    ],
    nextActions: [
      { text: "完成测试环境接口稳定性修复", owner: "接口服务组", departmentName: "前端开发组、测试组" },
      { text: "确认数据权限方案并输出文档", owner: "数据平台组", departmentName: "业务系统组" },
      { text: "推进第三方服务审批及接口开通", owner: "运维组", departmentName: "集成组" },
    ],
  },
};

const statusLabel = { missing: "未提交", late: "迟交", pending: "待提交", submitted: "已提交" };
const emptyDashboard = () => ({ reportDate: today(), generatedAt: new Date().toISOString(), metrics: { submitted: 0, expected: 0, missing: 0, late: 0 }, members: [], reports: [], summary: { blockers: [], decisions: [], nextActions: [] } });

export function TeamReportsAdminPage() {
  const [user, setUser] = useState(null);
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [date, setDate] = useState(today());
  const [departmentId, setDepartmentId] = useState("");
  const [member, setMember] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dingtalkStatus, setDingtalkStatus] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [decided, setDecided] = useState(new Set());
  const [orgSyncAttempt, setOrgSyncAttempt] = useState(0);
  const lastOrgState = useRef("");

  const load = useCallback(async (currentUser = user) => {
    if (!currentUser) { setDashboard(emptyDashboard()); return; }
    setBusy(true); setError("");
    try { setDashboard(await loadTeamDashboard({ date, departmentId, member })); }
    catch (failure) { setError(failure.message || "团队日报加载失败"); }
    finally { setBusy(false); }
  }, [date, departmentId, member, user]);

  useEffect(() => {
    getDailyReportUser().then((value) => { const next = value?.user || value; setUser(next); void load(next); }).catch(() => setDashboard(emptyDashboard()));
    return subscribeDailyReportAuth((next) => { setUser(next); void load(next); });
  }, []);
  useEffect(() => { loadDingTalkStatus().then((result) => setDingtalkStatus(result.data || result)).catch(() => {}); }, []);
  useEffect(() => { if (user) void load(user); }, [user, load]);

  // 组织同步状态轮询：同步中/等待时持续刷新，完成后自动重新请求团队日报
  const refreshDingtalkStatus = useCallback(async () => {
    const result = await loadDingTalkStatus().then((value) => value?.data || value).catch(() => null);
    if (result) setDingtalkStatus(result);
    return result?.organization || null;
  }, []);
  useEffect(() => {
    if (!user) return;
    let timer = null;
    const poll = async () => {
      const organization = await refreshDingtalkStatus();
      const status = organization?.sync?.status || "idle";
      const previous = lastOrgState.current;
      lastOrgState.current = status;
      if (previous && previous !== status && status === "succeeded") void load(user);
      if (status === "syncing" || status === "idle") timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { if (timer) clearTimeout(timer); };
  }, [user, load, refreshDingtalkStatus, orgSyncAttempt]);

  const syncLogs = async () => {
    if (!user) return;
    setBusy(true); setError("");
    try { await syncDingTalkReports({ scope: "team-reports", date }); await Promise.all([load(user), loadDingTalkStatus().then((result) => setDingtalkStatus(result.data || result))]); }
    catch (failure) { setError(failure.message || "团队钉钉日志同步失败"); }
    finally { setBusy(false); }
  };

  // 显式重试组织关系同步
  const retryOrgSync = async () => {
    if (!user) return;
    setBusy(true); setError("");
    try {
      await syncDingTalkOrganization();
      // A completed prior sync stops the normal poller. Restart it explicitly
      // after a manual retry so the dashboard refreshes when this new job ends.
      lastOrgState.current = "";
      await refreshDingtalkStatus();
      setOrgSyncAttempt((value) => value + 1);
    }
    catch (failure) { setError(failure.message || "组织关系同步重试失败"); }
    finally { setBusy(false); }
  };

  const departments = useMemo(() => (dashboard.departments || []).map((item) => ({ id: item.id, name: item.name, memberCount: item.memberCount })), [dashboard.departments]);
  const orgSyncStatus = dingtalkStatus?.organization?.sync?.status || dashboard.organizationSync?.status || "idle";
  const orgSynced = dingtalkStatus?.organization?.synced === true || dashboard.organizationSync?.status === "succeeded";
  const completion = dashboard.metrics.expected ? Math.round(dashboard.metrics.submitted / dashboard.metrics.expected * 100) : 0;
  const toggleDecided = (index) => setDecided((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; });
  const memberDepartments = (item) => (item.departmentNames?.length ? item.departmentNames.join(" · ") : (item.departmentName || "未同步部门"));

  return <div className="page team-dashboard-page">
    <PageHeader eyebrow="TEAM / DAILY REPORTS" title="团队日报" description="汇总团队提交、共同阻塞与需要领导决策的关键事项。" meta={<span>每天 08:00 自动同步</span>} actions={<><div className="team-dashboard-filters"><label>日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>部门<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">全部部门</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}{item.memberCount ? `（${item.memberCount}）` : ""}</option>)}</select></label><label>成员<select value={member} onChange={(event) => setMember(event.target.value)}><option value="">全部成员</option>{dashboard.members.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label></div><button className="work-button" disabled={!user || busy} onClick={syncLogs} type="button"><IconRefresh size={15} />{busy ? "同步中…" : "同步日志"}</button><button className="work-button" disabled={!user || busy || orgSyncStatus === "syncing"} onClick={retryOrgSync} type="button">{orgSyncStatus === "syncing" ? "组织同步中…" : "重新同步组织"}</button></>} />
    {!user ? <div className="work-notice"><span className="status-dot status-dot--warn" /><div><strong>当前展示安全的合成演示数据</strong><span>在系统状态登录钉钉组织账号后，将按你的直属关系加载真实团队日报。</span></div></div> : null}
    <DingTalkSyncStatus label="钉钉团队日志" status={dingtalkStatus} />
    {user && !orgSynced ? <div className="work-notice"><span className="status-dot status-dot--warn" /><div><strong>{orgSyncStatus === "failed" ? "组织关系同步失败，当前展示上一次成功数据" : orgSyncStatus === "syncing" ? "正在同步组织关系…" : "等待组织关系同步…"}</strong><span>后台将自动补全你的直属与递归下属；同步完成后团队日报会自动刷新。</span></div></div> : null}
    {error ? <div className="work-error" role="alert">{error}</div> : null}
    <section className="team-metric-strip"><div><span>今日提交人数 / 应提交人数</span><strong>{dashboard.metrics.submitted}<i>/</i>{dashboard.metrics.expected}</strong><div className="team-progress"><i style={{ width: `${completion}%` }} /></div><small>{completion}%</small></div><div><span>未提交</span><strong>{dashboard.metrics.missing}<small>人</small></strong></div><div><span>迟交</span><strong>{dashboard.metrics.late}<small>人</small></strong></div><div><span>最新同步时间</span><strong>{new Date(dashboard.generatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</strong><small><IconCheck size={13} />数据已同步</small></div></section>
    <div className="team-dashboard-grid">
      <section className="team-dashboard-panel"><h2>团队共同阻塞</h2><div className="team-blocker-list">{dashboard.summary.blockers.map((item, index) => <article key={`${item.text}-${index}`}><i /><div><strong>{item.text}</strong><small>涉及：{item.departments?.join("、") || "跨团队"}</small></div><span>{item.affectedMembers?.length || 1} 人</span><b>{index === 0 ? "高" : "中"}</b></article>)}</div><button className="team-panel-link" type="button">查看全部阻塞（{dashboard.summary.blockers.length}）<IconChevronRight size={14} /></button></section>
      <section className="team-dashboard-panel"><h2>需要领导决策</h2><div className="team-decision-list">{dashboard.summary.decisions.map((item, index) => <article className={decided.has(index) ? "is-decided" : ""} key={`${item.text}-${index}`}><div><strong>{item.text}</strong><small>{item.owner || "待指定负责人"}</small></div><time>{item.dueAt || "尽快"}</time><button onClick={() => toggleDecided(index)} type="button">{decided.has(index) ? "已决策" : "标记已决策"}</button></article>)}</div><button className="team-panel-link" type="button">查看全部决策<IconChevronRight size={14} /></button></section>
      <section className="team-dashboard-panel"><h2>明日关键行动</h2><div className="team-action-list">{dashboard.summary.nextActions.map((item, index) => <article key={`${item.text}-${index}`}><i /><strong>{item.text}</strong><span>{item.owner || "待认领"}</span><small>{item.departmentName || "跨团队协作"}</small></article>)}</div></section>
      <section className="team-dashboard-panel"><h2>未提交与迟交成员</h2><div className="team-member-list">{dashboard.members.filter((item) => item.status === "missing" || item.status === "late").map((item) => <article key={item.id}><strong>{item.displayName}</strong><span>{memberDepartments(item)}</span><b className={`is-${item.status}`}><i />{statusLabel[item.status]}</b><button type="button">提醒</button></article>)}</div></section>
    </div>
    <section className="team-detail-entry"><div><h2>日报明细</h2><p>查看团队成员今日提交的日报详情，支持按部门或成员筛选。</p></div><button className="work-button" onClick={() => setDetailsOpen((value) => !value)} type="button">{detailsOpen ? "收起日报明细" : "查看日报明细"}<IconChevronRight size={14} /></button></section>
    {detailsOpen ? <section className="team-report-list">{dashboard.reports.length ? dashboard.reports.map((report) => <article className="team-report-card" key={report.id}><div className="team-report-card__head"><strong>{report.displayName}</strong><time>{report.submittedAt}</time></div><h3>{report.summary}</h3><dl><div><dt>阻塞</dt><dd>{report.blockers || "无"}</dd></div><div><dt>协作</dt><dd>{report.cooperationNeeds || "无"}</dd></div><div><dt>下一步</dt><dd>{report.nextActions || "无"}</dd></div></dl>{(() => { let count = 0; try { count = JSON.parse(report.attachments || "[]").length; } catch { count = 0; } return count ? <small className="team-report-card__attachments">含 {count} 个附件</small> : null; })()}</article>) : <div className="report-empty"><strong>演示视图不包含日报原文</strong><span>登录后只展示你权限范围内的最终日报文本。</span></div>}</section> : null}
  </div>;
}
