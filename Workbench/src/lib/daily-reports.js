const bridge = () => globalThis.window?.workbench?.dailyReports || null;
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
async function localDingTalk(pathname, options = {}) {
  const response = await fetch(pathname, { ...options, headers: { Accept: "application/json", "Content-Type": "application/json", ...(options.headers || {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error?.message || "本地钉钉服务请求失败。");
  return result;
}

function publishAuthChange(user) {
  globalThis.window?.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail: user || null }));
}

export function subscribeDailyReportAuth(listener) {
  const handler = (event) => listener(event.detail || null);
  globalThis.window?.addEventListener(AUTH_EVENT, handler);
  return () => globalThis.window?.removeEventListener(AUTH_EVENT, handler);
}

async function remote(pathname, options = {}) {
  const response = await fetch(pathname, {
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
        const refresh = await fetch("/api/local-team/auth/refresh", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${remoteToken}` } });
        const refreshed = await refresh.json().catch(() => ({}));
        if (refresh.ok && refreshed.token) {
          remoteToken = refreshed.token;
          persistToken(remoteToken);
          const retry = await fetch(pathname, { ...options, headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${remoteToken}`, ...(options.headers || {}) } });
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
  return localDingTalk(`/api/local-daily-reports/${encodeURIComponent(date)}`);
}
export function loadOwnDailyReports({ from, to } = {}) {
  const query = new URLSearchParams({ from: String(from || ""), to: String(to || "") });
  return localDingTalk(`/api/local-daily-reports?${query}`);
}
export function syncDingTalkReports({ scope, date } = {}) {
  return localDingTalk("/api/local-daily-reports/sync", { method: "POST", body: JSON.stringify({ scope, date }) });
}
// 触发一次后台组织同步（登录后自动进行，这里用于显式重试）
export function syncDingTalkOrganization() {
  return localDingTalk("/api/dingtalk/organization/sync", { method: "POST", body: "{}" });
}
export function startDingTalkDailyReportLogin() {
  return bridge()?.dingtalkStart() || localDingTalk("/api/dingtalk/oauth/start", { method: "POST", body: "{}" });
}
export function checkDingTalkDailyReportConnection() {
  if (bridge()) return bridge().dingtalkStart().then(() => ({ reachable: true }));
  return localDingTalk("/api/dingtalk/status").then((status) => ({ reachable: status.configured === true, error: status.configured ? null : { message: `缺少配置：${(status.missingConfiguration || []).join(", ")}` } }));
}
export function exchangeDingTalkDailyReportLogin(loginToken) {
  const request = bridge()
    ? bridge().dingtalkExchange(loginToken)
    : getDailyReportUser();
  return request.then((result) => {
    const user = result?.user || result;
    if (!bridge()) { remoteToken = result.token; persistToken(remoteToken); }
    publishAuthChange(user);
    return user;
  });
}
export function getDailyReportUser() {
  if (!bridge()) {
    return localDingTalk("/api/dingtalk/status").then((status) => {
      if (!status.connected) throw new Error("未登录");
      return { id: status.accountId || status.profile?.id, displayName: status.profile?.displayName || "钉钉已连接", avatarUrl: status.profile?.avatarUrl || null, departmentName: status.profile?.departmentName || "本地工作台", role: status.profile?.role || "member", canViewTeamReports: Boolean(status.profile?.canViewTeamReports) };
    });
  }
  return bridge()?.me() || Promise.reject(new Error("未登录"));
}

export async function logoutDailyReport() {
  try {
    if (bridge()) await bridge().logout();
    else await localDingTalk("/api/dingtalk/logout", { method: "POST", body: "{}" });
  } finally {
    remoteToken = null;
    clearStoredToken();
    publishAuthChange(null);
  }
}

export function listDailyReportAccounts() {
  return bridge()?.accounts?.() || localDingTalk("/api/dingtalk/accounts");
}

export async function switchDailyReportAccount(accountId) {
  const result = bridge()?.switchAccount
    ? await bridge().switchAccount(accountId)
    : await localDingTalk("/api/dingtalk/accounts/switch", { method: "POST", body: JSON.stringify({ accountId }) });
  const user = result?.profile ? { id: result.accountId || result.profile.id, displayName: result.profile.displayName || "钉钉已连接", avatarUrl: result.profile.avatarUrl || null, departmentName: result.profile.departmentName || "本地工作台", role: result.profile.role || "member", canViewTeamReports: Boolean(result.profile.canViewTeamReports) } : await getDailyReportUser();
  publishAuthChange(user);
  return user;
}

export function loadAdminDailyReports(filters = {}) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  if (bridge()) return bridge().adminReports(filters);
  return localDingTalk(`/api/local-team/reports?${query}`);
}

export function loadTeamDashboard(filters = {}) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== ""));
  return localDingTalk(`/api/local-team/dashboard?${query}`);
}

export function loadTeamWeeklySummary(filters = {}) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  return localDingTalk(`/api/local-team/weekly-summary?${query}`);
}
