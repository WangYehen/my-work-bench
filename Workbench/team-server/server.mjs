import http from "node:http";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProxyAgent } from "undici";
import mysql from "mysql2/promise";
import { createDingTalkReportService, dingtalkReportDate } from "./dingtalk-reports.mjs";
import { createDingTalkAuthService, normalizeDingTalkIdentity } from "./dingtalk-auth.mjs";
import { shanghaiDate, startDailyReportSyncScheduler } from "./report-sync-schedule.mjs";
import { createDingTalkTokenManager } from "../shared/dingtalk-token-manager.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.TEAM_REPORT_PORT || 8787);
let pool = null;
let databaseReady = false;
const sessions = new Map();
const loginSessions = new Map();
const oauthReturnOrigins = new Map();
const allowedOrigins = String(process.env.TEAM_REPORT_ALLOWED_ORIGIN || "*").split(",").map((origin) => origin.trim()).filter(Boolean);
const uiOrigin = String(process.env.TEAM_REPORT_UI_URL || "http://127.0.0.1:5174").replace(/\/$/, "");
const adminDingTalkIds = new Set(String(process.env.TEAM_REPORT_ADMIN_DINGTALK_IDS || "").split(",").map((value) => value.trim()).filter(Boolean));
const now = () => new Date();
const error = (code, message, details = undefined) => Object.assign(new Error(message), { code, details });

function tokenKey() {
  try { const value = Buffer.from(String(process.env.DINGTALK_TOKEN_ENCRYPTION_KEY || ""), "base64"); return value.length === 32 ? value : null; } catch { return null; }
}
function seal(value, key) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({ iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
}
function unseal(value, key) {
  const payload = JSON.parse(value); const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8"));
}
function createDingTalkDbTokenStore() {
  const key = tokenKey();
  if (!key) return null;
  return {
    async get(subject) { if (!pool) return null; const [rows] = await pool.execute("SELECT ciphertext FROM dingtalk_tokens WHERE token_key = ? LIMIT 1", [subject]); return rows[0] ? unseal(rows[0].ciphertext, key) : null; },
    async set(subject, value) { if (!pool) throw error("TEAM_DATABASE_UNAVAILABLE", "团队日报数据库不可用。"); await pool.execute("INSERT INTO dingtalk_tokens (token_key, ciphertext, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE ciphertext=VALUES(ciphertext), updated_at=VALUES(updated_at)", [subject, seal(value, key), now()]); },
    async delete(subject) { if (pool) await pool.execute("DELETE FROM dingtalk_tokens WHERE token_key = ?", [subject]); },
  };
}

function json(res, status, body) {
  const requestOrigin = String(res.req?.headers?.origin || "");
  const origin = allowedOrigins.includes("*") ? "*" : (allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0] || "*");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    Vary: "Origin",
  });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw error("REQUEST_TOO_LARGE", "请求体过大。");
  }
  return raw ? JSON.parse(raw) : {};
}

function safeUsername(identity) {
  const base = String(identity.displayName || identity.dingtalkUserId).replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 120) || "钉钉成员";
  return `${base}-${identity.dingtalkUserId.slice(-8)}`;
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.displayName,
    dingtalkUserId: row.dingtalk_user_id || row.dingtalkUserId,
    departmentName: row.department_name || row.departmentName || null,
    avatarUrl: row.avatar_url || row.avatarUrl || null,
    managerUserId: row.manager_user_id || row.managerUserId || null,
    role: row.role,
    status: row.status,
    lastSyncedAt: row.last_synced_at || row.lastSyncedAt || null,
  };
}

export function reportDeadline(reportDate, hour = Number(process.env.DAILY_REPORT_DEADLINE_HOUR || 18)) {
  return new Date(`${reportDate}T${String(hour).padStart(2, "0")}:00:00+08:00`);
}

export function isWorkingDay(reportDate) {
  const day = new Date(`${reportDate}T12:00:00+08:00`).getUTCDay();
  return day >= 1 && day <= 5;
}

function splitLines(value) {
  return String(value || "").split(/\r?\n|[；;]/).map((item) => item.replace(/^[-*•\d.、\s]+/, "").trim()).filter((item) => item && item !== "无");
}

export function summarizeTeamReports(reports = []) {
  const blockerGroups = new Map();
  const decisions = [];
  const nextActions = [];
  for (const report of reports) {
    for (const blocker of splitLines(report.blockers)) {
      const key = blocker.replace(/[，。！？\s]/g, "").slice(0, 24);
      const group = blockerGroups.get(key) || { text: blocker, affectedMembers: [], departments: [] };
      if (!group.affectedMembers.includes(report.displayName || report.username)) group.affectedMembers.push(report.displayName || report.username);
      if (report.departmentName && !group.departments.includes(report.departmentName)) group.departments.push(report.departmentName);
      blockerGroups.set(key, group);
      if (/决策|确认|批准|审批|拍板|资源|支持/.test(blocker)) decisions.push({ text: blocker, owner: report.displayName || report.username, departmentName: report.departmentName, dueAt: report.reportDate });
    }
    for (const need of splitLines(report.cooperationNeeds)) {
      if (/决策|确认|批准|审批|拍板|资源|支持/.test(need)) decisions.push({ text: need, owner: report.displayName || report.username, departmentName: report.departmentName, dueAt: report.reportDate });
    }
    for (const action of splitLines(report.nextActions)) nextActions.push({ text: action, owner: report.displayName || report.username, departmentName: report.departmentName });
  }
  return {
    blockers: [...blockerGroups.values()].sort((a, b) => b.affectedMembers.length - a.affectedMembers.length).slice(0, 8),
    decisions: decisions.slice(0, 8),
    nextActions: nextActions.slice(0, 10),
    source: "rules",
  };
}

async function upsertDingTalkUser(identity) {
  const timestamp = now();
  const role = adminDingTalkIds.has(identity.dingtalkUserId) ? "admin" : "member";
  const username = safeUsername(identity);
  await pool.execute(`INSERT INTO users
    (username, display_name, dingtalk_user_id, dingtalk_union_id, department_name, avatar_url, manager_user_id, role, status, last_synced_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE username=VALUES(username), display_name=VALUES(display_name), dingtalk_user_id=VALUES(dingtalk_user_id), dingtalk_union_id=VALUES(dingtalk_union_id),
      department_name=VALUES(department_name), avatar_url=VALUES(avatar_url), manager_user_id=VALUES(manager_user_id),
      role=IF(users.role='admin', users.role, VALUES(role)), status=VALUES(status),
      last_synced_at=VALUES(last_synced_at), updated_at=VALUES(updated_at)`,
  [
    username,
    identity.displayName,
    identity.dingtalkUserId,
    identity.dingtalkUnionId ?? null,
    identity.departmentName ?? null,
    identity.avatarUrl ?? null,
    identity.managerUserId ?? null,
    role,
    identity.active ? "active" : "disabled",
    timestamp,
    timestamp,
    timestamp,
  ]);
  const [rows] = await pool.execute("SELECT id, username, display_name, dingtalk_user_id, dingtalk_union_id, department_name, avatar_url, manager_user_id, role, status, last_synced_at FROM users WHERE dingtalk_union_id <=> ? OR dingtalk_user_id = ? LIMIT 1", [identity.dingtalkUnionId ?? null, identity.dingtalkUserId]);
  const user = rows[0];
  if (!user || user.status !== "active") throw error("DINGTALK_USER_DISABLED", "当前钉钉用户未启用日报权限。");
  return user;
}

async function auth(req, requiredRole = null) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) { sessions.delete(token); throw error("AUTH_REQUIRED", "请先使用钉钉登录。"); }
  if (session.expiresAt - Date.now() < 24 * 60 * 60 * 1000) session.expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const [rows] = await pool.execute("SELECT id, username, display_name, dingtalk_user_id, department_name, avatar_url, manager_user_id, role, status, last_synced_at FROM users WHERE id = ? LIMIT 1", [session.userId]);
  const user = rows[0];
  if (!user || user.status !== "active") { sessions.delete(token); throw error("AUTH_REQUIRED", "当前钉钉用户已被停用，请重新登录。"); }
  if (requiredRole && user.role !== requiredRole) throw error("FORBIDDEN", "没有权限执行该操作。");
  return user;
}

async function audit(userId, action, targetType, targetId = null) {
  await pool.execute("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, created_at) VALUES (?, ?, ?, ?, ?)", [userId, action, targetType, targetId, now()]);
}

async function visibleUserIds(user) {
  if (user.role === "admin") {
    const [rows] = await pool.execute("SELECT id FROM users WHERE status = 'active'");
    return rows.map((row) => row.id);
  }
  const [rows] = await pool.execute("SELECT id, dingtalk_user_id, manager_user_id FROM users WHERE status = 'active'");
  const children = new Map();
  for (const row of rows) {
    const key = String(row.manager_user_id || "");
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(row.id);
  }
  const result = new Set([user.id]);
  const queue = [...(children.get(String(user.dingtalk_user_id)) || [])];
  while (queue.length) {
    const id = queue.shift();
    if (result.has(id)) continue;
    result.add(id);
    const child = rows.find((row) => row.id === id);
    if (child) {
      const childUser = rows.filter((row) => row.manager_user_id === child.dingtalk_user_id).map((row) => row.id);
      queue.push(...childUser);
    }
  }
  return [...result];
}

async function listReportsForUser(user, from, to) {
  const ids = await visibleUserIds(user);
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await pool.execute(`SELECT r.id, r.report_date AS reportDate, r.summary, r.completed_items AS completedItems,
    r.blockers, r.next_actions AS nextActions, r.cooperation_needs AS cooperationNeeds,
    r.images, r.attachments, r.template_name AS templateName, r.submitted_at AS submittedAt, u.id AS userId,
    u.username, u.display_name AS displayName, u.department_name AS departmentName
    FROM daily_reports r JOIN users u ON u.id = r.user_id
    WHERE r.user_id IN (${placeholders}) AND r.report_date BETWEEN ? AND ?
    ORDER BY r.report_date DESC, u.display_name ASC`, [...ids, from, to]);
  return rows;
}

// 按钉钉用户 ID 查找工作台用户
async function findUserByDingtalkId(dingtalkUserId) {
  const [rows] = await pool.execute("SELECT id FROM users WHERE dingtalk_user_id = ? LIMIT 1", [dingtalkUserId]);
  return rows[0] || null;
}

// 钉钉日志创建者尚未在工作台注册时，懒创建占位用户以承接其日报数据
async function createPlaceholderUser(report) {
  const timestamp = now();
  const username = safeUsername({ displayName: report.creatorName, dingtalkUserId: report.creatorId });
  await pool.execute(`INSERT INTO users
    (username, display_name, dingtalk_user_id, department_name, role, status, last_synced_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'member', 'active', ?, ?, ?)
    ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), department_name=VALUES(department_name),
      last_synced_at=VALUES(last_synced_at), updated_at=VALUES(updated_at)`,
  [username, report.creatorName || "钉钉成员", report.creatorId, report.deptName || null, timestamp, timestamp, timestamp]);
  return findUserByDingtalkId(report.creatorId);
}

// 将指定日期范围的钉钉日志同步入库（可仅同步单个用户），返回同步统计
async function syncReportRange({ from, to, userId = null, actorUserId = null, force = false }) {
  if (!dingtalkReports) return { synced: false, reason: "not_configured" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return { synced: false, reason: "invalid_range" };
  const throttleKey = `${userId || "team"}:${from}:${to}`;
  if (!force && Date.now() - (reportSyncThrottle.get(throttleKey) || 0) < reportSyncTtlMs) return { synced: false, reason: "throttled" };
  const lookbackFrom = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(Date.now() - reportSyncLookbackDays * 24 * 60 * 60 * 1_000));
  const effectiveFrom = from < lookbackFrom ? lookbackFrom : from;
  const reports = await dingtalkReports.fetchReportList({ from: effectiveFrom, to, userId });
  let upserted = 0;
  let skipped = 0;
  for (const report of reports) {
    const reportDate = dingtalkReportDate(report.createTime);
    if (!report.creatorId || !reportDate) { skipped += 1; continue; }
    let owner = await findUserByDingtalkId(report.creatorId);
    if (!owner) owner = await createPlaceholderUser(report);
    if (!owner) { skipped += 1; continue; }
    const [existing] = await pool.execute("SELECT submitted_at, dingtalk_report_id FROM daily_reports WHERE user_id = ? AND report_date = ?", [owner.id, reportDate]);
    const row = existing[0];
    if (row?.dingtalk_report_id && row.dingtalk_report_id !== report.reportId) {
      const existingAt = row.submitted_at ? Date.parse(row.submitted_at) : 0;
      if (report.createTime <= existingAt) { skipped += 1; continue; }
    }
    await pool.execute(`INSERT INTO daily_reports
      (user_id, report_date, summary, completed_items, blockers, next_actions, cooperation_needs, images, attachments, template_name, remark, dingtalk_report_id, submitted_at, extra, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE summary=VALUES(summary), completed_items=VALUES(completed_items), blockers=VALUES(blockers),
        next_actions=VALUES(next_actions), cooperation_needs=VALUES(cooperation_needs), images=VALUES(images),
        attachments=VALUES(attachments), template_name=VALUES(template_name), remark=VALUES(remark),
        dingtalk_report_id=VALUES(dingtalk_report_id), submitted_at=VALUES(submitted_at), extra=VALUES(extra), updated_at=VALUES(updated_at)`,
    [owner.id, reportDate, report.completedItems, report.completedItems, report.blockers, report.nextActions, report.cooperationNeeds, report.images, report.attachments, report.templateName, report.remark, report.reportId, new Date(report.createTime).toISOString(), JSON.stringify(report.extra), now()]);
    upserted += 1;
  }
  reportSyncThrottle.set(throttleKey, Date.now());
  if (upserted && actorUserId) await audit(actorUserId, "sync", "daily_report", `${effectiveFrom}:${to}`);
  return { synced: true, pulled: reports.length, upserted, skipped };
}

// 查询前按需同步：同步失败时降级返回存量数据，不阻塞查询
async function syncBeforeQuery({ from, to, userId = null, actorUserId = null }) {
  try {
    return await syncReportRange({ from, to, userId, actorUserId });
  } catch (failure) {
    console.warn(`DingTalk report sync skipped: ${failure.message}`);
    return { synced: false, reason: "sync_failed" };
  }
}

async function decoratedUser(user) {
  const ids = await visibleUserIds(user);
  let recipient = null;
  if (user.manager_user_id) {
    const [rows] = await pool.execute("SELECT display_name AS displayName, username FROM users WHERE dingtalk_user_id = ? AND status = 'active' LIMIT 1", [user.manager_user_id]);
    recipient = rows[0] || null;
  }
  if (!recipient) {
    const [rows] = await pool.execute("SELECT display_name AS displayName, username FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 1");
    recipient = rows[0] || null;
  }
  return { ...publicUser(user), canViewTeamReports: user.role === "admin" || ids.some((id) => Number(id) !== Number(user.id)), reportRecipient: recipient };
}

async function teamDashboard(user, query) {
  const reportDate = query.get("date") || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw error("INVALID_REPORT_DATE", "日报日期无效。");
  await syncBeforeQuery({ from: reportDate, to: reportDate, actorUserId: user.id });
  const ids = await visibleUserIds(user);
  if (!ids.length) return { reportDate, metrics: { submitted: 0, expected: 0, missing: 0, late: 0 }, members: [], reports: [], summary: summarizeTeamReports([]) };
  const placeholders = ids.map(() => "?").join(",");
  const department = String(query.get("department") || "").trim();
  const member = String(query.get("member") || "").trim();
  const [members] = await pool.execute(`SELECT id, username, display_name AS displayName, department_name AS departmentName FROM users WHERE id IN (${placeholders}) AND status='active' ORDER BY display_name`, ids);
  const filteredMembers = members.filter((item) => (!department || item.departmentName === department) && (!member || String(item.id) === member));
  const memberIds = filteredMembers.map((item) => item.id);
  const reports = memberIds.length ? await listReportsForUser(user, reportDate, reportDate) : [];
  const allowed = new Set(memberIds.map(Number));
  const filteredReports = reports.filter((item) => allowed.has(Number(item.userId)));
  const byUser = new Map(filteredReports.map((item) => [Number(item.userId), item]));
  const cutoff = reportDeadline(reportDate);
  const current = now();
  const workingDay = isWorkingDay(reportDate);
  const statusMembers = filteredMembers.map((item) => {
    const report = byUser.get(Number(item.id));
    const submittedAt = report?.submittedAt ? new Date(report.submittedAt) : null;
    const status = report ? (submittedAt > cutoff ? "late" : "submitted") : (workingDay && current > cutoff ? "missing" : "pending");
    return { ...item, status, submittedAt: report?.submittedAt || null };
  });
  return {
    reportDate,
    deadlineAt: cutoff.toISOString(),
    metrics: {
      submitted: statusMembers.filter((item) => item.status === "submitted" || item.status === "late").length,
      expected: workingDay ? statusMembers.length : 0,
      missing: statusMembers.filter((item) => item.status === "missing").length,
      late: statusMembers.filter((item) => item.status === "late").length,
    },
    members: statusMembers,
    reports: filteredReports,
    summary: summarizeTeamReports(filteredReports),
    generatedAt: current.toISOString(),
  };
}

function redirect(res, location) {
  res.writeHead(302, { "Cache-Control": "no-store", Location: location });
  res.end();
}

function allowedReturnUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!/^https?:$/.test(parsed.protocol)) return null;
    const origin = parsed.origin;
    return allowedOrigins.includes("*") || allowedOrigins.includes(origin) ? origin : null;
  } catch {
    return null;
  }
}

const dingtalkTokenStore = createDingTalkDbTokenStore();
const dingtalkProxy = process.env.DINGTALK_HTTPS_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const dingtalkDispatcher = dingtalkProxy ? new ProxyAgent(dingtalkProxy) : null;
const dingtalkTokenManager = dingtalkTokenStore ? createDingTalkTokenManager({ store: dingtalkTokenStore, requestToken: async (body) => {
  const response = await fetch(`${process.env.DINGTALK_API_BASE_URL || "https://api.dingtalk.com"}/v1.0/oauth2/userAccessToken`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: process.env.DINGTALK_CLIENT_ID, clientSecret: process.env.DINGTALK_CLIENT_SECRET, ...body }), ...(dingtalkDispatcher ? { dispatcher: dingtalkDispatcher } : {}) });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw error("DINGTALK_TOKEN_REFRESH_FAILED", value.message || value.code || "钉钉 token 刷新失败。", value);
  return value;
} }) : null;
const dingtalk = createDingTalkAuthService({
  config: {
    clientId: process.env.DINGTALK_CLIENT_ID,
    clientSecret: process.env.DINGTALK_CLIENT_SECRET,
    redirectUri: process.env.DINGTALK_TEAM_OAUTH_REDIRECT_URI,
    apiBaseUrl: process.env.DINGTALK_API_BASE_URL,
    authorizeUrl: process.env.DINGTALK_AUTHORIZE_URL,
    scopes: process.env.DINGTALK_TEAM_OAUTH_SCOPES || "openid",
  },
  tokenManager: dingtalkTokenManager,
});

// 钉钉日志（日报）拉取服务：与企业 access token 存储共用加密数据库
const dingtalkReports = dingtalkTokenStore && process.env.DINGTALK_CLIENT_ID && process.env.DINGTALK_CLIENT_SECRET
  ? createDingTalkReportService({
      config: {
        clientId: process.env.DINGTALK_CLIENT_ID,
        clientSecret: process.env.DINGTALK_CLIENT_SECRET,
        apiBaseUrl: process.env.DINGTALK_API_BASE_URL || "https://api.dingtalk.com",
        topapiBaseUrl: process.env.DINGTALK_TOPAPI_BASE_URL || "https://oapi.dingtalk.com",
        reportListPath: process.env.DINGTALK_REPORT_LIST_PATH || "/topapi/report/list",
        templateName: process.env.DINGTALK_REPORT_TEMPLATE_NAME || "IT部门日报",
        dispatcher: dingtalkDispatcher,
      },
      store: dingtalkTokenStore,
    })
  : null;
const reportSyncThrottle = new Map();
const reportSyncTtlMs = Number(process.env.DINGTALK_REPORT_SYNC_TTL_MS || 60_000);
const reportSyncLookbackDays = Number(process.env.DINGTALK_REPORT_MAX_LOOKBACK_DAYS || 90);

async function route(req, res) {
  if (req.method === "OPTIONS") return json(res, 204, {});
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.method === "GET" && url.pathname === "/healthz") return json(res, 200, { ok: true, databaseReady });
  if (req.method === "GET" && url.pathname === "/api/team/auth/dingtalk/check") return json(res, 200, await dingtalk.checkConnectivity());
  if (!databaseReady) throw error("TEAM_DATABASE_UNAVAILABLE", "团队日报数据库未配置或暂时不可用，个人工作台仍可正常使用。", { configured: Boolean(process.env.MYSQL_URL) });
  if (req.method === "POST" && url.pathname === "/api/team/auth/dingtalk/start") {
    const input = await body(req);
    const started = dingtalk.startLogin();
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    if (state) oauthReturnOrigins.set(state, { origin: allowedReturnUrl(input.returnUrl) || uiOrigin, expiresAt: Date.now() + 10 * 60 * 1000 });
    return json(res, 200, started);
  }
  if (req.method === "GET" && url.pathname === "/api/team/auth/dingtalk/callback") {
    const state = url.searchParams.get("state");
    const returnOrigin = oauthReturnOrigins.get(state)?.origin || uiOrigin;
    oauthReturnOrigins.delete(state);
    try {
      const user = await dingtalk.completeLogin({ code: url.searchParams.get("code") || url.searchParams.get("authCode"), state, error: url.searchParams.get("error") });
      const dbUser = await upsertDingTalkUser(user);
      const loginToken = cryptoRandomToken();
      loginSessions.set(loginToken, { userId: dbUser.id, expiresAt: Date.now() + 60_000 });
      return redirect(res, `${returnOrigin}/system?dingtalk_login=${encodeURIComponent(loginToken)}`);
    } catch (failure) {
      const params = new URLSearchParams({ dingtalk_error: String(failure.code || "DINGTALK_LOGIN_FAILED"), dingtalk_error_message: String(failure.message || "钉钉登录失败").slice(0, 300) });
      return redirect(res, `${returnOrigin}/system?${params}`);
    }
  }
  if (req.method === "POST" && url.pathname === "/api/team/auth/logout") {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    sessions.delete(token);
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/api/team/auth/refresh") {
    const user = await auth(req);
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    return json(res, 200, { token, user: publicUser(user) });
  }
  if (req.method === "POST" && url.pathname === "/api/team/auth/exchange") {
    const input = await body(req);
    const pending = loginSessions.get(String(input.token || ""));
    loginSessions.delete(String(input.token || ""));
    if (!pending || pending.expiresAt < Date.now()) throw error("AUTH_EXCHANGE_INVALID", "钉钉登录凭证已失效，请重新登录。");
    const token = cryptoRandomToken();
    sessions.set(token, { userId: pending.userId, issuedAt: Date.now(), expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    const [rows] = await pool.execute("SELECT id, username, display_name, dingtalk_user_id, department_name, avatar_url, manager_user_id, role, status, last_synced_at FROM users WHERE id = ? LIMIT 1", [pending.userId]);
    return json(res, 200, { token, user: publicUser(rows[0]) });
  }
  const user = await auth(req);
  if (req.method === "GET" && url.pathname === "/api/team/me") return json(res, 200, { user: await decoratedUser(user) });
  if (req.method === "POST" && url.pathname === "/api/team/daily-reports/sync") {
    const input = await body(req);
    const scope = String(input.scope || "daily-report");
    const reportDate = String(input.date || shanghaiDate(now()));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw error("INVALID_REPORT_DATE", "日报日期无效。");
    let from = reportDate;
    let to = reportDate;
    let userId = user.dingtalk_user_id;
    if (scope === "today-work") {
      from = shanghaiDate(new Date(`${reportDate}T12:00:00+08:00`), -1);
      to = from;
    } else if (scope === "team-reports") {
      userId = null;
    } else if (scope !== "daily-report") {
      throw error("INVALID_SYNC_SCOPE", "不支持的日报同步范围。");
    }
    const result = await syncReportRange({ from, to, userId, actorUserId: user.id, force: true });
    if (!result.synced && result.reason === "not_configured") throw error("DINGTALK_REPORT_NOT_CONFIGURED", "尚未配置钉钉日志同步服务。");
    return json(res, 200, { ...result, scope, from, to });
  }
  if (req.method === "GET" && url.pathname === "/api/team/dashboard") return json(res, 200, await teamDashboard(user, url.searchParams));
  if (req.method === "GET" && url.pathname === "/api/team/dashboard/summary") {
    const dashboard = await teamDashboard(user, url.searchParams);
    return json(res, 200, dashboard.summary);
  }
  if (req.method === "GET" && url.pathname === "/api/team/weekly-summary") {
    const from = url.searchParams.get("from") || "1000-01-01";
    const to = url.searchParams.get("to") || "9999-12-31";
    await syncBeforeQuery({ from, to, actorUserId: user.id });
    const reports = await listReportsForUser(user, from, to);
    return json(res, 200, { from, to, reportCount: reports.length, ...summarizeTeamReports(reports) });
  }
  if (req.method === "GET" && url.pathname === "/api/team/daily-reports/me") {
    const from = url.searchParams.get("from") || "1000-01-01";
    const to = url.searchParams.get("to") || "9999-12-31";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw error("INVALID_DATE_RANGE", "日报日期范围无效。");
    await syncBeforeQuery({ from, to, userId: user.dingtalk_user_id, actorUserId: user.id });
    const ids = [user.id];
    const placeholders = ids.map(() => "?").join(",");
    const [rows] = await pool.execute(`SELECT id, report_date AS reportDate, summary, completed_items AS completedItems, blockers, next_actions AS nextActions, cooperation_needs AS cooperationNeeds, images, attachments, template_name AS templateName, remark, dingtalk_report_id AS dingtalkReportId, submitted_at AS submittedAt, updated_at AS updatedAt FROM daily_reports WHERE user_id IN (${placeholders}) AND report_date BETWEEN ? AND ? ORDER BY report_date ASC`, [...ids, from, to]);
    return json(res, 200, { items: rows });
  }
  const ownMatch = url.pathname.match(/^\/api\/team\/daily-reports\/me\/(\d{4}-\d{2}-\d{2})$/);
  if (ownMatch && req.method === "GET") {
    await syncBeforeQuery({ from: ownMatch[1], to: ownMatch[1], userId: user.dingtalk_user_id, actorUserId: user.id });
    const [rows] = await pool.execute(`SELECT id, report_date AS reportDate, summary, completed_items AS completedItems, blockers, next_actions AS nextActions, cooperation_needs AS cooperationNeeds, images, attachments, template_name AS templateName, remark, dingtalk_report_id AS dingtalkReportId, submitted_at AS submittedAt, updated_at AS updatedAt FROM daily_reports WHERE user_id = ? AND report_date = ?`, [user.id, ownMatch[1]]);
    return json(res, 200, rows[0] || null);
  }
  if (req.method === "GET" && url.pathname === "/api/team/reports") {
    const from = url.searchParams.get("from") || "1000-01-01";
    const to = url.searchParams.get("to") || "9999-12-31";
    await syncBeforeQuery({ from, to, actorUserId: user.id });
    return json(res, 200, { items: await listReportsForUser(user, from, to) });
  }
  if (req.method === "GET" && url.pathname === "/api/team/members") {
    const ids = await visibleUserIds(user);
    const placeholders = ids.map(() => "?").join(",");
    const [rows] = await pool.execute(`SELECT id, username, display_name AS displayName, department_name AS departmentName, role, status FROM users WHERE id IN (${placeholders}) ORDER BY display_name`, ids);
    return json(res, 200, { items: rows });
  }
  throw error("NOT_FOUND", "接口不存在。");
}

function cryptoRandomToken() {
  return randomBytes(32).toString("base64url");
}

if (process.env.MYSQL_URL || process.env.MYSQL_HOST) {
  pool = mysql.createPool({
    uri: process.env.MYSQL_URL,
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : undefined,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true,
  });
  try {
    const schema = fs.readFileSync(path.join(root, "schema.sql"), "utf8");
    for (const statement of schema.split(/;\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean)) await pool.query(statement);
    await migrateUsersTable();
    await migrateDailyReportsTable();
    databaseReady = true;
  } catch (startupError) {
    console.warn(`Team report database unavailable: ${startupError.message}`);
  }
}

if (databaseReady && dingtalkReports) {
  startDailyReportSyncScheduler({
    hour: Number(process.env.DINGTALK_REPORT_DAILY_SYNC_HOUR || 8),
    run: (range) => syncReportRange({ ...range, force: true }),
  });
}

// 旧库迁移：为已有 users 表补充钉钉头像列（MySQL 8.0 不支持 ADD COLUMN IF NOT EXISTS）
async function migrateUsersTable() {
  const [columns] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'avatar_url'");
  if (Number(columns[0]?.n || 0) === 0) await pool.query("ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500) NULL AFTER department_name");
}

// 旧库迁移：为已有 daily_reports 表补充钉钉日志相关列与唯一索引
async function migrateDailyReportsTable() {
  const [columns] = await pool.query("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'daily_reports'");
  const names = new Set(columns.map((column) => column.name));
  const additions = [
    ["cooperation_needs", "TEXT NOT NULL"],
    ["images", "TEXT NOT NULL"],
    ["attachments", "TEXT NOT NULL"],
    ["template_name", "VARCHAR(128) NULL"],
    ["remark", "TEXT NULL"],
    ["dingtalk_report_id", "VARCHAR(64) NULL"],
    ["extra", "JSON NULL"],
  ];
  for (const [column, definition] of additions) {
    if (!names.has(column)) await pool.query(`ALTER TABLE daily_reports ADD COLUMN ${column} ${definition}`);
  }
  const [indexes] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'daily_reports' AND index_name = 'uq_daily_report_dingtalk'");
  if (Number(indexes[0]?.n || 0) === 0) await pool.query("CREATE UNIQUE INDEX uq_daily_report_dingtalk ON daily_reports (dingtalk_report_id)");
}

http.createServer((req, res) => route(req, res).catch((err) => {
  const status = err.code === "AUTH_REQUIRED" ? 401 : err.code === "FORBIDDEN" || err.code === "DINGTALK_USER_DISABLED" ? 403 : err.code === "NOT_FOUND" ? 404 : err.code === "TEAM_DATABASE_UNAVAILABLE" ? 503 : err.code?.startsWith("DINGTALK_") ? 502 : 400;
  json(res, status, { error: { code: err.code || "TEAM_SERVER_ERROR", message: err.message, details: err.details } });
})).listen(port, "127.0.0.1", () => console.log(`Team report server listening on ${port}`));

export { visibleUserIds, normalizeDingTalkIdentity };
