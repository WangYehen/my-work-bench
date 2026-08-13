const bridge = () => globalThis.window?.workbench?.dailyReports || null;
const remoteBase = String(import.meta.env.VITE_TEAM_REPORT_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
if (remoteBase && !/^https:\/\//i.test(remoteBase) && !/^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(remoteBase) && !/^https?:\/\/localhost(?::\d+)?$/i.test(remoteBase)) {
  throw new Error("VITE_TEAM_REPORT_API_URL 必须使用 HTTPS（本机开发可使用 localhost）。");
}
const AUTH_STORAGE_KEY = "workbench:team-auth:v1";
function authStorage() { try { return globalThis.localStorage || null; } catch { return null; } }
function readStoredToken() {
  const value = authStorage()?.getItem(AUTH_STORAGE_KEY);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.version === 1 && typeof parsed.token === "string" && parsed.token.trim()) return parsed.token;
  } catch {
    // Remove malformed persisted credentials below.
  }
  clearStoredToken();
  return null;
}
function persistToken(token) { try { authStorage()?.setItem(AUTH_STORAGE_KEY, JSON.stringify({ version: 1, token })); } catch { /* storage unavailable */ } }
function clearStoredToken() { try { authStorage()?.removeItem(AUTH_STORAGE_KEY); } catch { /* storage unavailable */ } }
let remoteToken = readStoredToken();
const AUTH_EVENT = "workbench:team-auth-changed";

function publishAuthChange(user) {
  globalThis.window?.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: user || null }));
}

export function subscribeDailyReportAuth(listener) {
  const handler = (event) => listener(event.detail || null);
  globalThis.window?.addEventListener(AUTH_EVENT, handler);
  return () => globalThis.window?.removeEventListener(AUTH_EVENT, handler);
}

async function remote(pathname, options = {}) {
  const response = await fetch(`${remoteBase}${pathname}`, {
    ...options,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(remoteToken ? { Authorization: `Bearer ${remoteToken}` } : {}), ...(options.headers || {}) },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = new Error(result?.error?.message || "日报服务请求失败。");
    failure.status = response.status;
    failure.code = result?.error?.code;
    if (response.status === 401 && remoteToken) {
      try {
        const refresh = await fetch(`${remoteBase}/api/team/auth/refresh`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${remoteToken}` } });
        const refreshed = await refresh.json().catch(() => ({}));
        if (refresh.ok && refreshed.token) {
          remoteToken = refreshed.token;
          persistToken(remoteToken);
          const retry = await fetch(`${remoteBase}${pathname}`, { ...options, headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${remoteToken}`, ...(options.headers || {}) } });
          const retryResult = await retry.json().catch(() => ({}));
          if (retry.ok) return retryResult;
        }
      } catch { /* fall through to the normal signed-out state */ }
      remoteToken = null;
      clearStoredToken();
      publishAuthChange(null);
    }
    throw failure;
  }
  return result;
}

export function getDailyReport(date) {
  return bridge()?.get(date) || remote(`/api/team/daily-reports/me/${date}`);
}
export function loadOwnDailyReports({ from, to } = {}) {
  if (bridge()) return bridge().list({ from, to }).then((items) => ({ items }));
  const query = new URLSearchParams({ from: String(from || ""), to: String(to || "") });
  return remote(`/api/team/daily-reports/me?${query}`);
}
export function saveDailyReport(report) {
  return bridge()?.save(report) || remote(`/api/team/daily-reports/me/${report.reportDate}`, { method: "PUT", body: JSON.stringify(report) });
}
export function submitDailyReport(report) {
  return bridge()?.submit(report) || remote(`/api/team/daily-reports/me/${report.reportDate}`, { method: "PUT", body: JSON.stringify(report) });
}
export function startDingTalkDailyReportLogin() {
  return bridge()?.dingtalkStart() || remote("/api/team/auth/dingtalk/start", { method: "POST", body: JSON.stringify({ returnUrl: globalThis.location?.origin || "" }) });
}
export function checkDingTalkDailyReportConnection() {
  return remote("/api/team/auth/dingtalk/check");
}
export function exchangeDingTalkDailyReportLogin(loginToken) {
  const request = bridge()
    ? bridge().dingtalkExchange(loginToken)
    : remote("/api/team/auth/exchange", { method: "POST", body: JSON.stringify({ token: loginToken }) });
  return request.then((result) => {
    const user = result?.user || result;
    if (!bridge()) { remoteToken = result.token; persistToken(remoteToken); }
    publishAuthChange(user);
    return user;
  });
}
export function getDailyReportUser() {
  return bridge()?.me() || (remoteToken ? remote("/api/team/me") : Promise.reject(new Error("未登录")));
}

export async function logoutDailyReport() {
  try {
    if (bridge()) await bridge().logout();
    else if (remoteToken) await remote("/api/team/auth/logout", { method: "POST" });
  } finally {
    remoteToken = null;
    clearStoredToken();
    publishAuthChange(null);
  }
}

export function loadAdminDailyReports(filters = {}) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  if (bridge()) return bridge().adminReports(filters);
  return remote(`/api/team/reports?${query}`);
}
