import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDingTalkTokenManager } from "../shared/dingtalk-token-manager.mjs";

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 4 * 1024 * 1024;
const OAUTH_SESSION_MS = 10 * 60 * 1000;
const APP_TOKEN_REFRESH_WINDOW_MS = 2 * 60 * 1000;
const DEFAULT_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const SYNC_RESOURCES = new Set(["events", "todos"]);

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
    if (!value || value.version !== STORE_VERSION || !Array.isArray(value.events)) fail("DINGTALK_STATE_CORRUPT", "钉钉本地状态内容无效。");
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

export function normalizeDingTalkEvent(event) { return normalizeEvent(event); }
export function normalizeDingTalkTodo(todo) { return normalizeTodo(todo); }

export function createDingTalkService({ config: suppliedConfig = {}, stateDirectory = path.resolve(".local/dingtalk"), fetchImpl = fetch, now = () => new Date(), syncIntervalMs = DEFAULT_SYNC_INTERVAL_MS, startScheduler = true } = {}) {
  const config = normalizeConfig(suppliedConfig);
  const statePath = path.join(stateDirectory, "state.enc.json");
  const sessions = new Map();
  let stateQueue = Promise.resolve();
  let syncQueue = Promise.resolve();
  const syncFlights = new Map();
  let cachedAppToken = null;

  async function readState() {
    if (!config.tokenKey) return emptyState();
    try { const details = await lstat(statePath); if (!details.isFile() || details.isSymbolicLink() || details.size > MAX_STORE_BYTES) fail("DINGTALK_STATE_UNSAFE", "钉钉本地状态文件无效或过大。"); const state = decrypt(JSON.parse(await readFile(statePath, "utf8")), config.tokenKey); state.events = state.events.map(normalizeEvent); state.todos = Array.isArray(state.todos) ? state.todos.map(normalizeTodo) : []; state.sync = normalizeSyncState(state.sync); return state; }
    catch (error) { if (error?.code === "ENOENT") return emptyState(); throw error; }
  }
  function writeState(next) {
    const operation = stateQueue.then(async () => {
      if (!config.tokenKey) fail("DINGTALK_NOT_CONFIGURED", "请先配置钉钉本地环境变量。");
      await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
      const payload = `${JSON.stringify(encrypt(next, config.tokenKey), null, 2)}\n`;
      if (Buffer.byteLength(payload) > MAX_STORE_BYTES) fail("DINGTALK_STATE_TOO_LARGE", "钉钉本地状态超过安全上限。");
      const temporary = `${statePath}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, payload, { encoding: "utf8", flag: "wx", mode: 0o600 }); await rename(temporary, statePath); } finally { await unlink(temporary).catch(() => {}); }
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
  function statusFrom(state) { const token = state.connection?.token; const expiresAt = Date.parse(token?.expiresAt || ""); const sync = normalizeSyncState(state.sync); const flightKeys = [...syncFlights.keys()]; return { configured: missingConfiguration(config).length === 0, missingConfiguration: missingConfiguration(config), connected: Boolean(token?.accessToken), lastSyncAt: sync.lastSuccessAt, lastError: sync.lastError, eventCount: state.events.length, todoCount: state.todos.length, lastTodoSyncAt: sync.todos.lastSuccessAt, lastTodoError: sync.todos.lastError, sync: { events: { ...sync.events, itemCount: state.events.length, syncing: flightKeys.some((key) => key.includes("events")) }, todos: { ...sync.todos, itemCount: state.todos.length, syncing: flightKeys.some((key) => key.includes("todos")) } }, token: { expiresAt: Number.isFinite(expiresAt) ? new Date(expiresAt).toISOString() : null, refreshing: false, needsRefresh: Boolean(token && tokenManager.needsRefresh(token)), lastRefreshedAt: token?.refreshedAt || null, refreshError: sync.lastError === "DINGTALK_TOKEN_EXPIRED" ? sync.lastError : null, requiresReauthorization: sync.lastError === "DINGTALK_TOKEN_EXPIRED" } }; }
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
    const current = await tokenManager.getUserAccessToken("local");
    state.connection.token = current;
    return current.accessToken;
  }
  async function withTokenRetry(operation) {
    try { return await operation(); }
    catch (error) {
      if (error.code !== "DINGTALK_TOKEN_EXPIRED") throw error;
      await tokenManager.refreshUserAccessToken("local");
      return operation();
    }
  }
  async function resolveUserId(token) {
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
    const state = await readState(); const token = await accessToken(state); const userId = await resolveUserId(token);
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
      todos.push(...(value.todoCards || value.tasks || value.items || []));
      const currentToken = value.nextToken || value.next_token || null;
      if (!currentToken || currentToken === nextToken) break;
      nextToken = currentToken;
    }
    return todos.map(normalizeTodo);
  }
  function localDate(value) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }
  function currentMonthRange() { const current = now(); return { from: localDate(new Date(current.getFullYear(), current.getMonth(), 1)), to: localDate(new Date(current.getFullYear(), current.getMonth() + 1, 0)) }; }
  function normalizeResources(resources) { const values = resources == null ? ["events", "todos"] : Array.isArray(resources) ? resources : [resources]; const result = [...new Set(values.map(String))]; if (!result.length || result.some((resource) => !SYNC_RESOURCES.has(resource))) fail("DINGTALK_INVALID_SYNC_RESOURCES", "钉钉同步资源无效。"); return result; }
  async function performSync({ resources, from, to }) {
    const attemptedAt = now().toISOString();
    const outcomes = {};
    if (resources.includes("events")) { try { outcomes.events = { data: await withTokenRetry(() => apiEvents(from, to)), successAt: now().toISOString() }; } catch (error) { outcomes.events = { error }; } }
    if (resources.includes("todos")) { try { outcomes.todos = { data: await withTokenRetry(() => apiTodos()), successAt: now().toISOString() }; } catch (error) { outcomes.todos = { error }; } }
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
      return { ...status, resources, from: rangeFrom, to: rangeTo, events: result.outcomes.events?.data, todos: result.outcomes.todos?.data };
    });
    syncQueue = operation.catch(() => {});
    const flight = operation.finally(() => syncFlights.delete(key));
    syncFlights.set(key, flight);
    return flight;
  }
  async function scheduledSync() { if (missingConfiguration(config).length) return; const state = await readState(); if (!state.connection?.token?.accessToken) return; await queueSync({ resources: ["events", "todos"], throwOnError: false }); }
  const scheduler = startScheduler ? setInterval(() => { void scheduledSync().catch(() => {}); }, syncIntervalMs) : null;
  scheduler?.unref?.();
  if (startScheduler) void scheduledSync().catch(() => {});
  return {
    async status() { return statusFrom(await readState()); },
    async todos() { requireConfigured(); return (await readState()).todos || []; },
    async startOAuth() { requireConfigured(); const state = randomUUID(); sessions.set(state, { expiresAt: now().getTime() + OAUTH_SESSION_MS }); const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope: "openid", state }); return { authorizationUrl: `${config.authorizeUrl}?${query}` }; },
    async completeOAuth({ code, state: stateValue, error }) { requireConfigured(); if (error) fail("DINGTALK_OAUTH_DENIED", "钉钉授权未完成。"); const session = sessions.get(stateValue); sessions.delete(stateValue); if (!code || !session || session.expiresAt < now().getTime()) fail("DINGTALK_OAUTH_STATE_INVALID", "钉钉授权会话已失效，请重新连接。"); const current = await readState(); const token = await requestToken({ grantType: "authorization_code", code }); await tokenManager.saveUserExchange("local", token); current.connection = { connectedAt: now().toISOString(), code: text(code, 8192), token: await tokenManager.getUserAccessToken("local") }; current.sync = normalizeSyncState(current.sync); current.sync.lastError = null; await writeState(current); await queueSync({ resources: ["events", "todos"], throwOnError: false }); return statusFrom(await readState()); },
    async sync(options = {}) { return queueSync(options); },
    async list({ from, to } = {}) { const state = await readState(); return state.events.filter((event) => (!from || event.startAt.slice(0, 10) >= from) && (!to || event.startAt.slice(0, 10) <= to)); },
  };
}
