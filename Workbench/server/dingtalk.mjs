import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDingTalkTokenManager } from "../shared/dingtalk-token-manager.mjs";

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 4 * 1024 * 1024;
const OAUTH_SESSION_MS = 10 * 60 * 1000;
const APP_TOKEN_REFRESH_WINDOW_MS = 2 * 60 * 1000;
const DEFAULT_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const SYNC_RESOURCES = new Set(["events"]);
const ORGANIZATION_MEMBER_CONCURRENCY = 8;
const ORGANIZATION_DEPARTMENT_CONCURRENCY = 8;

export class DingTalkServiceError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "DingTalkServiceError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new DingTalkServiceError(code, message, details); }
function text(value, max = 512) { const valueText = value == null || typeof value === "object" ? "" : String(value).trim(); return valueText && valueText !== "[object Object]" ? valueText.slice(0, max) : null; }
function isoDate(value) { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function emptyResourceSync() { return { lastAttemptAt: null, lastSuccessAt: null, lastError: null }; }
function emptyState() { return { version: STORE_VERSION, connection: null, events: [], todos: [], sync: { lastAttemptAt: null, lastSuccessAt: null, lastError: null, lastTodoSuccessAt: null, lastTodoError: null, events: emptyResourceSync(), todos: emptyResourceSync() } }; }
function resourceValue(resource, key, legacyValue) { return resource && Object.hasOwn(resource, key) ? resource[key] : legacyValue || null; }
function normalizeSyncState(sync = {}) { return { ...sync, events: { ...emptyResourceSync(), ...(sync.events || {}), lastAttemptAt: resourceValue(sync.events, "lastAttemptAt", sync.lastAttemptAt), lastSuccessAt: resourceValue(sync.events, "lastSuccessAt", sync.lastSuccessAt), lastError: resourceValue(sync.events, "lastError", sync.lastError) }, todos: { ...emptyResourceSync(), ...(sync.todos || {}), lastSuccessAt: resourceValue(sync.todos, "lastSuccessAt", sync.lastTodoSuccessAt), lastError: resourceValue(sync.todos, "lastError", sync.lastTodoError) } }; }

function encrypt(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { version: STORE_VERSION, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

function decrypt(payload, key) {
  if (!payload?.iv || !payload?.tag || !payload?.ciphertext || payload.version !== STORE_VERSION) fail("DINGTALK_STATE_CORRUPT", "钉钉本地状态文件格式无效。");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8"));
    if (!value || typeof value !== "object") fail("DINGTALK_STATE_CORRUPT", "钉钉加密内容无效。");
    return value;
  } catch (error) {
    if (error instanceof DingTalkServiceError) throw error;
    fail("DINGTALK_STATE_UNREADABLE", "钉钉本地状态无法解密，请检查加密密钥。");
  }
}

function normalizeConfig(config = {}) {
  let tokenKey = null;
  try { const decoded = Buffer.from(text(config.tokenEncryptionKey) || "", "base64"); if (decoded.length === 32) tokenKey = decoded; } catch { /* status reports missing key */ }
  return {
    clientId: text(config.clientId, 256), clientSecret: text(config.clientSecret, 512), redirectUri: text(config.redirectUri, 1024), tokenKey,
    apiBaseUrl: text(config.apiBaseUrl, 1024) || "https://api.dingtalk.com",
    authorizeUrl: text(config.authorizeUrl, 1024) || "https://login.dingtalk.com/oauth2/auth",
    userId: text(config.userId, 256), calendarId: text(config.calendarId, 256) || "primary",
  };
}

function missingConfiguration(config) {
  return [["DINGTALK_CLIENT_ID", config.clientId], ["DINGTALK_CLIENT_SECRET", config.clientSecret], ["DINGTALK_OAUTH_REDIRECT_URI", config.redirectUri], ["DINGTALK_TOKEN_ENCRYPTION_KEY", config.tokenKey]].filter(([, value]) => !value).map(([key]) => key);
}

function normalizeEvent(event = {}) {
  const allDay = Boolean(event.isAllDay || event.allDay);
  const start = event.start?.dateTime || (event.start?.date && `${event.start.date}T00:00:00+08:00`) || event.startAt || event.startTime || event.start || event.beginTime;
  const end = event.end?.dateTime || (event.end?.date && `${event.end.date}T00:00:00+08:00`) || event.endAt || event.endTime || event.end || event.finishTime;
  const attendees = event.attendees || event.participants || [];
  return {
    id: text(event.id || event.eventId || randomUUID(), 256), title: text(event.subject || event.title || event.summary, 500) || "未命名日程",
    startAt: start ? isoDate(start) : null, endAt: end ? isoDate(end) : null,
    isAllDay: allDay, location: text(event.location?.displayName || event.location?.name || event.place, 500),
    organizer: text(event.organizer?.name || event.organizer?.displayName || event.organizer, 256),
    attendees: Array.isArray(attendees) ? attendees.map((item) => text(item.name || item.displayName || item.email || item, 256)).filter(Boolean) : [],
    meetingUrl: text(event.onlineMeeting?.joinUrl || event.onlineMeetingInfo?.url || event.meetingUrl || event.url || event.conferenceUrl, 1024), source: "dingtalk",
  };
}

function normalizeTodo(todo = {}) {
  const dueTime = Number(todo.dueTime || todo.dueAt || 0);
  const priority = Number(todo.priority || 20);
  const done = Boolean(todo.isDone || todo.done);
  return { id: `dingtalk:${text(todo.taskId || todo.id, 256) || randomUUID()}`, externalId: text(todo.taskId || todo.id, 256), title: text(todo.subject || todo.title, 500) || "钉钉待办", detail: text(todo.description, 1000), priority: priority >= 30 ? "P0" : priority <= 10 ? "P2" : "P1", dueAt: dueTime > 0 ? new Date(dueTime).toISOString() : null, status: done ? "completed" : "open", completed: done, url: text(todo.detailUrl?.pcUrl || todo.detailUrl?.appUrl, 1024), source: "dingtalk" };
}

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor; cursor += 1;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function normalizeDingTalkEvent(event) { return normalizeEvent(event); }
export function normalizeDingTalkTodo(todo) { return normalizeTodo(todo); }

export function createDingTalkService({ config: suppliedConfig = {}, stateDirectory = path.resolve(".local/dingtalk"), fetchImpl = fetch, now = () => new Date(), syncIntervalMs = DEFAULT_SYNC_INTERVAL_MS, startScheduler = true } = {}) {
  const config = normalizeConfig(suppliedConfig);
  const legacyStatePath = path.join(stateDirectory, "state.enc.json");
  const accountsPath = path.join(stateDirectory, "accounts.enc.json");
  const sessions = new Map();
  let stateQueue = Promise.resolve();
  let syncQueue = Promise.resolve();
  const syncFlights = new Map();
  let cachedAppToken = null;
  let activeAccountId = null;
  let accountSelectionLoaded = false;
  let hasAccountIndex = false;

  function accountFile(id) { return path.join(stateDirectory, "accounts", `${createHash("sha256").update(String(id)).digest("hex")}.enc.json`); }
  function statePath() { return activeAccountId ? accountFile(activeAccountId) : legacyStatePath; }
  async function readAccounts() {
    if (!config.tokenKey) return { activeAccountId: null, accounts: [] };
    try {
      const details = await lstat(accountsPath);
      if (!details.isFile() || details.isSymbolicLink() || details.size > MAX_STORE_BYTES) fail("DINGTALK_STATE_UNSAFE", "钉钉账号索引文件无效或过大。");
      const value = decrypt(JSON.parse(await readFile(accountsPath, "utf8")), config.tokenKey); hasAccountIndex = true;
      return { activeAccountId: value.activeAccountId || null, accounts: Array.isArray(value.accounts) ? value.accounts : [] };
    } catch (error) { if (error?.code === "ENOENT") { hasAccountIndex = false; return { activeAccountId: null, accounts: [] }; } throw error; }
  }
  async function writeAccounts(next) {
    if (!config.tokenKey) fail("DINGTALK_NOT_CONFIGURED", "请先完成钉钉本地环境变量配置。");
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    await writeFile(accountsPath, `${JSON.stringify(encrypt(next, config.tokenKey), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    hasAccountIndex = true;
  }
  async function ensureActiveAccount() { if (accountSelectionLoaded) return activeAccountId; activeAccountId = (await readAccounts()).activeAccountId || null; accountSelectionLoaded = true; return activeAccountId; }

  async function promoteLegacyAccount(state, profile) {
    const nextAccountId = String(profile?.id || "");
    await ensureActiveAccount();
    const previousAccountId = activeAccountId;
    if (!nextAccountId || !previousAccountId || previousAccountId === nextAccountId) return;
    const index = await readAccounts();
    const account = { id: nextAccountId, displayName: profile.displayName, avatarUrl: profile.avatarUrl, departmentName: profile.departmentName, lastUsedAt: now().toISOString() };
    activeAccountId = nextAccountId;
    await writeAccounts({ activeAccountId, accounts: [...index.accounts.filter((item) => item.id !== previousAccountId && item.id !== nextAccountId), account] });
    await writeState(state);
    await unlink(accountFile(previousAccountId)).catch(() => {});
  }

  async function readState() {
    if (!config.tokenKey) return emptyState();
    try { await ensureActiveAccount(); if (!activeAccountId && hasAccountIndex) return emptyState(); const file = statePath(); const details = await lstat(file); if (!details.isFile() || details.isSymbolicLink() || details.size > MAX_STORE_BYTES) fail("DINGTALK_STATE_UNSAFE", "钉钉本地状态文件无效或过大。"); const state = decrypt(JSON.parse(await readFile(file, "utf8")), config.tokenKey); if (state.version !== STORE_VERSION || !Array.isArray(state.events)) fail("DINGTALK_STATE_CORRUPT", "钉钉本地状态内容无效。"); state.events = state.events.map(normalizeEvent); state.todos = Array.isArray(state.todos) ? state.todos.map(normalizeTodo) : []; state.sync = normalizeSyncState(state.sync); return state; }
    catch (error) { if (error?.code === "ENOENT") return emptyState(); throw error; }
  }
  function writeState(next) {
    const operation = stateQueue.then(async () => {
      if (!config.tokenKey) fail("DINGTALK_NOT_CONFIGURED", "请先配置钉钉本地环境变量。");
      await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
      const payload = `${JSON.stringify(encrypt(next, config.tokenKey), null, 2)}\n`;
      if (Buffer.byteLength(payload) > MAX_STORE_BYTES) fail("DINGTALK_STATE_TOO_LARGE", "钉钉本地状态超过安全上限。");
      await ensureActiveAccount(); const file = statePath();
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      // 直接覆盖写；后台同步与状态刷新并发时避免临时文件 rename 在 Windows 上的 EPERM/ENOENT 竞态
      await writeFile(file, payload, { encoding: "utf8", mode: 0o600 });
      return next;
    });
    stateQueue = operation.catch(() => {}); return operation;
  }
  const tokenManager = createDingTalkTokenManager({
    store: {
      async get() { return (await readState()).connection?.token || null; },
      async set(_key, token) { const next = await readState(); next.connection = { ...(next.connection || {}), token }; await writeState(next); },
      async delete() { const next = await readState(); next.connection = null; await writeState(next); },
    },
    requestToken: (body) => requestToken(body),
  });
  function requireConfigured() { const missing = missingConfiguration(config); if (missing.length) fail("DINGTALK_NOT_CONFIGURED", "请先完成钉钉应用配置。", { missing }); }
  function statusFrom(state) { const token = state.connection?.token; const expiresAt = Date.parse(token?.expiresAt || ""); const sync = normalizeSyncState(state.sync); const flightKeys = [...syncFlights.keys()]; return { configured: missingConfiguration(config).length === 0, missingConfiguration: missingConfiguration(config), connected: Boolean(token?.accessToken), profile: state.connection?.profile || null, lastSyncAt: sync.lastSuccessAt, lastError: sync.lastError, eventCount: state.events.length, todoCount: state.todos.length, lastTodoSyncAt: sync.lastTodoSuccessAt, lastTodoError: sync.lastTodoError, sync: { events: { ...sync.events, itemCount: state.events.length, syncing: flightKeys.some((key) => key.includes("events")) }, todos: { ...sync.todos, itemCount: state.todos.length, syncing: flightKeys.some((key) => key.includes("todos")) } }, token: { expiresAt: Number.isFinite(expiresAt) ? new Date(expiresAt).toISOString() : null, refreshing: false, needsRefresh: Boolean(token && tokenManager.needsRefresh(token)), lastRefreshedAt: token?.refreshedAt || null, refreshError: sync.lastError === "DINGTALK_TOKEN_EXPIRED" ? sync.lastError : null, requiresReauthorization: sync.lastError === "DINGTALK_TOKEN_EXPIRED" } }; }
  async function requestToken(body) {
    const response = await fetchImpl(`${config.apiBaseUrl}/v1.0/oauth2/userAccessToken`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: config.clientId, clientSecret: config.clientSecret, ...body }) });
    if (!response.ok) fail("DINGTALK_TOKEN_EXCHANGE_FAILED", "钉钉授权令牌交换失败。");
    const value = await response.json(); if (!value?.accessToken && !value?.access_token) fail("DINGTALK_TOKEN_EXCHANGE_FAILED", "钉钉没有返回可用访问令牌。");
    return { accessToken: value.accessToken || value.access_token, refreshToken: value.refreshToken || value.refresh_token || null, expiresAt: new Date(now().getTime() + Number(value.expireIn || value.expires_in || 7200) * 1000).toISOString() };
  }
  async function appAccessToken() {
    if (cachedAppToken?.accessToken && Date.parse(cachedAppToken.expiresAt || "") - now().getTime() > APP_TOKEN_REFRESH_WINDOW_MS) return cachedAppToken.accessToken;
    const response = await fetchImpl(`${config.apiBaseUrl}/v1.0/oauth2/accessToken`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appKey: config.clientId, appSecret: config.clientSecret }) });
    let value = null; try { value = await response.json(); } catch {}
    if (!response.ok || (!value?.accessToken && !value?.access_token)) fail("DINGTALK_APP_TOKEN_REQUEST_FAILED", value?.message || value?.code || "钉钉应用访问令牌获取失败。", value);
    cachedAppToken = { accessToken: value.accessToken || value.access_token, expiresAt: new Date(now().getTime() + Number(value.expireIn || value.expires_in || 7200) * 1000).toISOString() };
    return cachedAppToken.accessToken;
  }
  async function accessToken(state) {
    const token = state.connection?.token; if (!token?.accessToken) fail("DINGTALK_NOT_CONNECTED", "钉钉尚未连接。");
    const current = await tokenManager.getUserAccessToken(activeAccountId || "legacy");
    state.connection.token = current;
    return current.accessToken;
  }
  async function withTokenRetry(operation) {
    try { return await operation(); }
    catch (error) {
      if (error.code !== "DINGTALK_TOKEN_EXPIRED") throw error;
      await tokenManager.refreshUserAccessToken(activeAccountId || "legacy");
      return operation();
    }
  }
  async function resolveUserProfile(token, { includeOrganization = false } = {}) {
    const response = await fetchImpl(`${config.apiBaseUrl}/v1.0/contact/users/me`, { headers: { Authorization: `Bearer ${token}`, "x-acs-dingtalk-access-token": token, "Content-Type": "application/json" } });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) return null;
    const id = value?.unionId || value?.unionid || value?.openId || value?.openid || value?.userId || value?.userid;
    if (!id) return null;
    const profile = { id: String(id), unionId: text(value.unionId || value.unionid, 256), displayName: text(value.name || value.nick || value.displayName, 256) || "钉钉用户", avatarUrl: text(value.avatar || value.avatarUrl || value.avatar_url, 2048), departmentName: text(value.departmentName || value.deptName, 256), departmentIds: [] };
    if (!profile.unionId) return profile;
    try {
      const appToken = await appAccessToken();
      const legacy = async (pathname, body) => {
        const response = await fetchImpl(`https://oapi.dingtalk.com${pathname}?access_token=${encodeURIComponent(appToken)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || Number(payload.errcode || 0) !== 0) throw new Error(payload.errmsg || payload.message || "钉钉组织信息同步失败");
        return payload.result || payload;
      };
      const reference = await legacy("/topapi/user/getbyunionid", { unionid: profile.unionId });
      const userId = text(reference.userid || reference.userId, 256);
      if (!userId) return profile;
      const detail = await legacy("/topapi/v2/user/get", { userid: userId, language: "zh_CN" });
      const departmentIds = Array.isArray(detail.dept_id_list) ? detail.dept_id_list.map(String) : [];
      let departmentName = profile.departmentName;
      if (!includeOrganization) {
        if (departmentIds[0]) {
          const department = await legacy("/topapi/v2/department/get", { dept_id: Number(departmentIds[0]), language: "zh_CN" });
          departmentName = text(department.name || department.dept_name, 256) || departmentName;
        }
        return { ...profile, id: userId, dingtalkUserId: userId, managerUserId: text(detail.manager_userid || detail.managerUserid, 256), departmentIds, departmentName, organizationMembers: [], organizationSynced: false };
      }
      let rootDepartmentId = departmentIds[0] || null;
      // 部门信息缓存：provider_id -> { id, name, parentId }，供写库维护名称与父子关系
      const departmentsByProvider = new Map();
      const rememberDepartment = async (deptId) => {
        const key = String(deptId);
        if (departmentsByProvider.has(key)) return departmentsByProvider.get(key);
        const department = await legacy("/topapi/v2/department/get", { dept_id: Number(deptId), language: "zh_CN" });
        const entry = { id: key, name: text(department.name || department.dept_name, 256), parentId: text(department.parent_id || department.parentid, 64) };
        departmentsByProvider.set(key, entry);
        return entry;
      };
      if (rootDepartmentId) {
        // A manager's direct report can be in a child department.  Walking up
        // to the visible root and then down its department tree gives the
        // server the complete reporting graph; a single department member list
        // only ever gave us peers (the source of Hollis missing Charles).
        for (let depth = 0; depth < 20 && rootDepartmentId; depth += 1) {
          const department = await rememberDepartment(rootDepartmentId);
          if (depth === 0) departmentName = department.name || departmentName;
          if (!department.parentId || department.parentId === rootDepartmentId || department.parentId === "1") break;
          rootDepartmentId = department.parentId;
        }
      }
      const departmentQueue = rootDepartmentId ? [rootDepartmentId] : [];
      const discoveredDepartments = new Set();
      const memberIds = new Set();
      // 部门树按批次并发遍历：同一部门的 dept/get、listid、listsubid 互相独立，
      // 并行发起；不同部门按批次（每批受限并发）推进，显著降低大组织的同步耗时。
      while (departmentQueue.length && discoveredDepartments.size < 500) {
        const batch = departmentQueue.splice(0, ORGANIZATION_DEPARTMENT_CONCURRENCY);
        const childLists = await Promise.all(batch.map(async (rawDeptId) => {
          const departmentId = String(rawDeptId);
          if (discoveredDepartments.has(departmentId)) return [];
          discoveredDepartments.add(departmentId);
          const [, listed, children] = await Promise.all([
            rememberDepartment(departmentId),
            legacy("/topapi/user/listid", { dept_id: Number(departmentId) }).then((payload) => payload.userid_list || []),
            legacy("/topapi/v2/department/listsubid", { dept_id: Number(departmentId) }).catch((error) => {
              // Some tenants have not granted the child-department scope.  Keep the
              // current department usable in that case, but don't claim that its
              // incomplete member list is a complete organisation graph.
              if (departmentId === String(rootDepartmentId)) throw error;
              return { dept_id_list: [] };
            }).then((payload) => payload.dept_id_list || []),
          ]);
          for (const memberId of listed) memberIds.add(String(memberId));
          return children.map(String);
        }));
        // 子部门只在真正被处理时才标记 discovered，避免提前标记导致漏读部门成员
        for (const childId of childLists.flat()) if (!discoveredDepartments.has(childId)) departmentQueue.push(childId);
      }
      const selectedMemberIds = [...memberIds].slice(0, 2000);
      const memberReadFailures = [];
      const organizationMembers = (await mapWithConcurrency(selectedMemberIds, ORGANIZATION_MEMBER_CONCURRENCY, async (memberId) => {
        try {
          const member = await legacy("/topapi/v2/user/get", { userid: memberId, language: "zh_CN" });
          const memberDepartmentIds = Array.isArray(member.dept_id_list) ? member.dept_id_list.map(String) : [];
          let memberDepartmentName = null;
          if (memberDepartmentIds[0]) {
            try { memberDepartmentName = (await rememberDepartment(memberDepartmentIds[0])).name; } catch { /* department name is optional */ }
          }
          return { id: String(member.userid || member.userId || memberId), displayName: text(member.name, 256) || "钉钉成员", avatarUrl: text(member.avatar, 2048), managerUserId: text(member.manager_userid || member.managerUserid, 256), departmentIds: memberDepartmentIds, departmentName: memberDepartmentName, organizationSynced: true };
        } catch (error) { memberReadFailures.push(error?.code || "DINGTALK_MEMBER_READ_FAILED"); return null; }
      })).filter(Boolean);
      return { ...profile, id: userId, dingtalkUserId: userId, managerUserId: text(detail.manager_userid || detail.managerUserid, 256), departmentIds, departmentName, organizationMembers, departments: [...departmentsByProvider.values()], organizationSynced: true, organizationMemberReadFailures: memberReadFailures.length };
    } catch (error) { return { ...profile, organizationSynced: false, organizationError: error.message }; }
  }
  async function resolveUserId(token) {
    const profile = await resolveUserProfile(token);
    // Calendar/Todo v1 paths use the user-scoped OAuth identifier (unionId /
    // openId), not the numeric enterprise userid used as our local account
    // key. Passing the latter produces: "parameter userId can not be parsed".
    if (profile?.unionId) return profile.unionId;
    if (config.userId) return config.userId;
    const candidates = [
      `${config.apiBaseUrl}/v1.0/contact/users/me`,
      `${config.apiBaseUrl}/v1.0/oauth2/userinfo`,
      `${config.apiBaseUrl}/v1.0/contact/users`,
      `${config.apiBaseUrl}/v1.0/me`,
    ];
    let lastDetails = null;
    for (const endpoint of candidates) {
      for (const auth of [`Bearer ${token}`, token]) {
        const response = await fetchImpl(endpoint, { headers: { Authorization: auth, "x-acs-dingtalk-access-token": token, "Content-Type": "application/json" } });
        let value = null; try { value = await response.json(); } catch {}
        if (!response.ok) { lastDetails = value; continue; }
        const userId = value?.unionId || value?.unionid || value?.openId || value?.openid;
        if (userId) return userId;
        lastDetails = value;
      }
    }
    fail("DINGTALK_USER_REQUEST_FAILED", lastDetails?.message || lastDetails?.code || `钉钉未返回当前用户标识（字段：${Object.keys(lastDetails || {}).join(",") || "无"}）。`, lastDetails);
  }
  async function apiEvents(from, to) {
    const state = await readState(); const userToken = await accessToken(state); const userId = await resolveUserId(userToken); const token = await appAccessToken();
    const events = [];
    let nextToken = null;
    for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ timeMin: new Date(`${from}T00:00:00+08:00`).toISOString(), timeMax: new Date(`${to}T23:59:59+08:00`).toISOString(), maxResults: "500" });
    if (nextToken) query.set("nextToken", nextToken);
    const response = await fetchImpl(`${config.apiBaseUrl}/v1.0/calendar/users/${encodeURIComponent(userId)}/calendars/${encodeURIComponent(config.calendarId)}/events?${query}`, { headers: { "x-acs-dingtalk-access-token": token, "Content-Type": "application/json" } });
    if (!response.ok) { let details = null; try { details = await response.json(); } catch {} if (response.status === 401) fail("DINGTALK_TOKEN_EXPIRED", "钉钉授权已过期，请重新连接。", details); fail("DINGTALK_CALENDAR_REQUEST_FAILED", details?.message || details?.code || "无法读取钉钉日程。", details); }
    const value = await response.json();
    events.push(...(value.events || value.items || value.result || []));
    const currentToken = value.nextToken || value.next_token || null;
    if (!currentToken || currentToken === nextToken) break;
    nextToken = currentToken;
    }
    return events.map(normalizeEvent).filter((event) => event.startAt);
  }
  async function apiTodos() {
    const state = await readState(); const userToken = await accessToken(state); const userId = await resolveUserId(userToken); const token = await appAccessToken();
    const todos = [];
    let nextToken = null;
    for (let page = 0; page < 20; page += 1) {
      const response = await fetchImpl(`${config.apiBaseUrl}/v1.0/todo/users/${encodeURIComponent(userId)}/org/tasks/query`, { method: "POST", headers: { "x-acs-dingtalk-access-token": token, "Content-Type": "application/json" }, body: JSON.stringify({ maxResults: 100, ...(nextToken ? { nextToken } : {}) }) });
      if (!response.ok) { let details = null; try { details = await response.json(); } catch {} if (response.status === 401) fail("DINGTALK_TOKEN_EXPIRED", "钉钉授权已过期，请重新连接。", details); fail("DINGTALK_TODO_REQUEST_FAILED", details?.message || details?.code || "无法读取钉钉待办。", details); }
      const value = await response.json();
      const result = value.result || value.data || value;
      todos.push(...(result.todoCards || result.tasks || result.items || result.list || []));
      const currentToken = result.nextToken || result.next_token || value.nextToken || value.next_token || null;
      if (!currentToken || currentToken === nextToken) break;
      nextToken = currentToken;
    }
    return todos.map(normalizeTodo);
  }
  function localDate(value) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }
  function currentMonthRange() { const current = now(); return { from: localDate(new Date(current.getFullYear(), current.getMonth(), 1)), to: localDate(new Date(current.getFullYear(), current.getMonth() + 1, 0)) }; }
  function normalizeResources(resources) { const values = resources == null ? ["events"] : Array.isArray(resources) ? resources.filter((resource) => resource !== "todos") : [resources]; const result = [...new Set(values.map(String))]; if (!result.length || result.some((resource) => !SYNC_RESOURCES.has(resource))) fail("DINGTALK_INVALID_SYNC_RESOURCES", "当前仅支持钉钉日程同步。"); return result; }
  async function performSync({ resources, from, to }) {
    const attemptedAt = now().toISOString();
    const outcomes = {};
    if (resources.includes("events")) { try { outcomes.events = { data: await withTokenRetry(() => apiEvents(from, to)), successAt: now().toISOString() }; } catch (error) { outcomes.events = { error }; } }
    const state = await readState();
    state.sync = normalizeSyncState(state.sync);
    if (outcomes.events) {
      state.sync.events.lastAttemptAt = attemptedAt;
      if (outcomes.events.error) state.sync.events.lastError = outcomes.events.error.code || "DINGTALK_CALENDAR_REQUEST_FAILED";
      else { state.events = [...state.events.filter((event) => event.startAt?.slice(0, 10) < from || event.startAt?.slice(0, 10) > to), ...outcomes.events.data].sort((a, b) => String(a.startAt).localeCompare(String(b.startAt))); state.sync.events.lastSuccessAt = outcomes.events.successAt; state.sync.events.lastError = null; }
    }
    if (outcomes.todos) {
      state.sync.todos.lastAttemptAt = attemptedAt;
      if (outcomes.todos.error) state.sync.todos.lastError = outcomes.todos.error.code || "DINGTALK_TODO_SYNC_FAILED";
      else { state.todos = outcomes.todos.data; state.sync.todos.lastSuccessAt = outcomes.todos.successAt; state.sync.todos.lastError = null; }
    }
    const successes = Object.values(outcomes).filter((outcome) => !outcome.error).map((outcome) => outcome.successAt);
    const failures = Object.values(outcomes).filter((outcome) => outcome.error).map((outcome) => outcome.error);
    state.sync.lastAttemptAt = attemptedAt;
    if (successes.length) state.sync.lastSuccessAt = successes.sort().at(-1);
    state.sync.lastError = failures[0]?.code || null;
    state.sync.lastTodoSuccessAt = state.sync.todos.lastSuccessAt;
    state.sync.lastTodoError = state.sync.todos.lastError;
    await writeState(state);
    return { state, outcomes, failures };
  }
  function queueSync({ resources: requestedResources, from, to, throwOnError = true } = {}) {
    requestedResources = Array.isArray(requestedResources) ? requestedResources.filter((resource) => resource !== "todos") : requestedResources === "todos" ? undefined : requestedResources;
    requireConfigured();
    const resources = normalizeResources(requestedResources);
    const range = currentMonthRange();
    const rangeFrom = from || range.from;
    const rangeTo = to || range.to;
    const key = `${resources.toSorted().join(",")}:${rangeFrom}:${rangeTo}`;
    if (syncFlights.has(key)) return syncFlights.get(key);
    const operation = syncQueue.then(async () => {
      const state = await readState();
      if (!state.connection?.token?.accessToken) fail("DINGTALK_NOT_CONNECTED", "钉钉尚未连接。");
      const result = await performSync({ resources, from: rangeFrom, to: rangeTo });
      if (throwOnError && result.failures.length) throw result.failures[0];
      const status = statusFrom(result.state);
      for (const resource of resources) status.sync[resource].syncing = false;
      return { ...status, resources, from: rangeFrom, to: rangeTo, events: result.outcomes.events?.data };
    });
    syncQueue = operation.catch(() => {});
    const flight = operation.finally(() => syncFlights.delete(key));
    syncFlights.set(key, flight);
    return flight;
  }
  async function scheduledSync() { if (missingConfiguration(config).length) return; const state = await readState(); if (!state.connection?.token?.accessToken) return; await queueSync({ resources: ["events"], throwOnError: false }); }
  const scheduler = startScheduler ? setInterval(() => { void scheduledSync().catch(() => {}); }, syncIntervalMs) : null;
  scheduler?.unref?.();
  if (startScheduler) void scheduledSync().catch(() => {});
  return {
    async status() {
      const state = await readState();
      // Older local archives used unionId as their file/account key.  The
      // organisation graph uses enterprise userid, so normalize that archive
      // once using only the lightweight current-user lookup (never a tree scan).
      if (state.connection?.token?.accessToken && state.connection.profile?.unionId && state.connection.profile.dingtalkUserId !== state.connection.profile.id) {
        const profile = await resolveUserProfile(await accessToken(state)).catch(() => null);
        if (profile?.dingtalkUserId) { state.connection.profile = profile; await promoteLegacyAccount(state, profile); }
      }
      return statusFrom(state);
    },
    async syncOrganization() { const state = await readState(); const profile = await resolveUserProfile(await accessToken(state), { includeOrganization: true }); if (!profile) fail("DINGTALK_ORGANIZATION_SYNC_FAILED", "无法读取钉钉组织信息。"); state.connection.profile = profile; await writeState(state); return statusFrom(state); },
    /* 供后台组织同步作业使用：返回完整组织画像（含所有部门成员），但不写入加密状态文件，避免超大组织撑爆存储上限。 */
    async organizationProfile(expectedAccountId) { await ensureActiveAccount(); if (expectedAccountId && activeAccountId !== String(expectedAccountId)) fail("DINGTALK_ORG_SYNC_CANCELLED", "钉钉账号已切换，已取消旧账号的组织同步。"); const state = await readState(); const token = state.connection?.token?.accessToken; if (!token) fail("DINGTALK_NOT_CONNECTED", "钉钉尚未连接。"); const profile = await resolveUserProfile(token, { includeOrganization: true }); if (!profile) fail("DINGTALK_ORGANIZATION_SYNC_FAILED", "无法读取钉钉组织信息。"); if (expectedAccountId && activeAccountId !== String(expectedAccountId)) fail("DINGTALK_ORG_SYNC_CANCELLED", "钉钉账号已切换，已取消旧账号的组织同步。"); return profile; },
    async startOAuth() { requireConfigured(); const state = randomUUID(); sessions.set(state, { expiresAt: now().getTime() + OAUTH_SESSION_MS }); const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope: "openid", state }); return { authorizationUrl: `${config.authorizeUrl}?${query}` }; },
    async completeOAuth({ code, state: stateValue, error }) { requireConfigured(); if (error) fail("DINGTALK_OAUTH_DENIED", "钉钉授权未完成。"); const session = sessions.get(stateValue); sessions.delete(stateValue); if (!code || !session || session.expiresAt < now().getTime()) fail("DINGTALK_OAUTH_STATE_INVALID", "钉钉授权会话已失效，请重新连接。"); const token = await requestToken({ grantType: "authorization_code", code }); /* OAuth 回调只识别当前用户；完整组织关系由 syncOrganization 独立补全，避免大组织登录超时。 */ const profile = await resolveUserProfile(token.accessToken); if (!profile?.dingtalkUserId) fail("DINGTALK_USER_REQUEST_FAILED", "无法识别当前钉钉账号，未保存登录状态。"); activeAccountId = profile.id; const index = await readAccounts(); const account = { id: profile.id, displayName: profile.displayName, avatarUrl: profile.avatarUrl, departmentName: profile.departmentName, lastUsedAt: now().toISOString() }; const accounts = [...index.accounts.filter((item) => item.id !== account.id), account]; await writeAccounts({ activeAccountId, accounts }); const current = emptyState(); current.connection = { connectedAt: now().toISOString(), token, profile }; current.sync = normalizeSyncState(current.sync); await writeState(current); void queueSync({ resources: ["events"], throwOnError: false }); return statusFrom(current); },
    async accounts() { const index = await readAccounts(); return { activeAccountId: index.activeAccountId || null, accounts: index.accounts.map(({ id, displayName, avatarUrl, departmentName, lastUsedAt }) => ({ id, displayName, avatarUrl, departmentName, lastUsedAt })) }; },
    async switchAccount(id) { const index = await readAccounts(); const account = index.accounts.find((item) => item.id === String(id)); if (!account) fail("DINGTALK_ACCOUNT_NOT_FOUND", "该钉钉账号不在本机档案中。"); activeAccountId = account.id; account.lastUsedAt = now().toISOString(); await writeAccounts({ activeAccountId, accounts: index.accounts }); const status = await this.status(); return { ...status, accountId: activeAccountId }; },
    async logout() { const index = await readAccounts(); const loggedOutAccountId = activeAccountId; activeAccountId = null; accountSelectionLoaded = true; const accounts = index.accounts.filter((account) => account.id !== loggedOutAccountId); await writeAccounts({ activeAccountId: null, accounts }); if (loggedOutAccountId) await unlink(accountFile(loggedOutAccountId)).catch(() => {}); return { ok: true }; },
    async sync(options = {}) { return queueSync(options); },
    async list({ from, to } = {}) { const state = await readState(); return state.events.filter((event) => (!from || event.startAt.slice(0, 10) >= from) && (!to || event.startAt.slice(0, 10) <= to)); },
  };
}
