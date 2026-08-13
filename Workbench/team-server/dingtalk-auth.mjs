import crypto from "node:crypto";
import dns from "node:dns";
import { ProxyAgent } from "undici";

// Some Windows networks allow curl over IPv4 but reject Node's first IPv6 attempt.
// Prefer IPv4 for DingTalk OAuth requests while keeping normal DNS fallback behavior.
dns.setDefaultResultOrder("ipv4first");

const DEFAULT_API_BASE_URL = "https://api.dingtalk.com";
const DEFAULT_LEGACY_API_BASE_URL = "https://oapi.dingtalk.com";
const DEFAULT_AUTHORIZE_URL = "https://login.dingtalk.com/oauth2/auth";

const text = (value, max = 512) => {
  const result = value == null || typeof value === "object" ? "" : String(value).trim();
  return result && result !== "[object Object]" ? result.slice(0, max) : null;
};

const first = (...values) => values.find((value) => text(value));

export class DingTalkAuthError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "DingTalkAuthError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new DingTalkAuthError(code, message, details);
}

function networkFailure(error, endpoint, proxyConfigured) {
  const cause = error?.code || error?.cause?.code || null;
  let message = `无法连接钉钉接口：${error?.message || "网络请求失败"}`;
  if (["EACCES", "ECONNREFUSED"].includes(cause)) message = "无法连接钉钉接口：当前网络未放行钉钉 HTTPS 端口，请配置 DINGTALK_HTTPS_PROXY 或放行 api.dingtalk.com:443。";
  else if (["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(cause)) message = "无法连接钉钉接口：钉钉接口连接超时，请检查网络、VPN 或代理。";
  else if (["ENOTFOUND", "EAI_AGAIN"].includes(cause)) message = "无法连接钉钉接口：钉钉域名解析失败，请检查 DNS 或网络。";
  return { code: "DINGTALK_NETWORK_ERROR", message, details: { endpoint, cause, proxyConfigured } };
}

export function normalizeDingTalkIdentity(value = {}) {
  const departments = Array.isArray(value.departments)
    ? value.departments
    : Array.isArray(value.deptList)
      ? value.deptList
      : [];
  const managerUserId = first(
    value.managerUserId,
    value.managerId,
    value.supervisorUserId,
    value.leaderUserId,
    value.leader?.userId,
    value.leader?.userid,
  );
  const dingtalkUserId = first(value.userId, value.userid, value.staffId, value.openId, value.openid, value.unionId, value.unionid);
  if (!dingtalkUserId) fail("DINGTALK_IDENTITY_INVALID", "钉钉没有返回可用的组织用户标识。", value);
  return {
    dingtalkUserId,
    dingtalkUnionId: first(value.unionId, value.unionid),
    displayName: first(value.name, value.displayName, value.nick, value.nickname, value.username) || dingtalkUserId,
    departmentName: first(value.departmentName, value.deptName, departments[0]?.name, departments[0]?.deptName),
    managerUserId,
    departmentIds: departments.map((item) => first(item.id, item.deptId, item.departmentId)).filter(Boolean),
    active: value.active !== false && value.disabled !== true && value.status !== "disabled",
  };
}

export function createDingTalkAuthService({ config = {}, fetchImpl = fetch, now = () => new Date(), tokenManager = null } = {}) {
  const clientId = text(config.clientId || process.env.DINGTALK_CLIENT_ID, 256);
  const clientSecret = text(config.clientSecret || process.env.DINGTALK_CLIENT_SECRET, 512);
  const apiBaseUrl = text(config.apiBaseUrl || process.env.DINGTALK_API_BASE_URL, 1024) || DEFAULT_API_BASE_URL;
  const legacyApiBaseUrl = text(config.legacyApiBaseUrl || process.env.DINGTALK_LEGACY_API_BASE_URL, 1024) || DEFAULT_LEGACY_API_BASE_URL;
  const authorizeUrl = text(config.authorizeUrl || process.env.DINGTALK_AUTHORIZE_URL, 1024) || DEFAULT_AUTHORIZE_URL;
  const redirectUri = text(config.redirectUri || process.env.DINGTALK_TEAM_OAUTH_REDIRECT_URI, 1024);
  const scopes = text(config.scopes || process.env.DINGTALK_TEAM_OAUTH_SCOPES, 512) || "openid";
  const proxyUrl = text(config.proxyUrl || process.env.DINGTALK_HTTPS_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY, 2048);
  let proxyConfigError = null;
  if (proxyUrl) {
    try { new URL(proxyUrl); } catch (error) { proxyConfigError = error; }
  }
  const dispatcher = proxyUrl && !proxyConfigError ? new ProxyAgent(proxyUrl) : null;
  const sessions = new Map();
  const sessionTtlMs = 10 * 60 * 1000;
  let appAccessToken = null;

  function requireConfigured() {
    if (proxyConfigError) fail("DINGTALK_PROXY_INVALID", "钉钉代理地址无效，请检查 DINGTALK_HTTPS_PROXY。", { proxyConfigured: true });
    const missing = [
      ["DINGTALK_CLIENT_ID", clientId],
      ["DINGTALK_CLIENT_SECRET", clientSecret],
      ["DINGTALK_TEAM_OAUTH_REDIRECT_URI", redirectUri],
    ].filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) fail("DINGTALK_AUTH_NOT_CONFIGURED", "尚未完成钉钉日报登录配置。", { missing });
  }

  async function requestJson(url, options = {}, errorCode) {
    let response;
    try {
      response = await fetchImpl(url, { ...options, ...(dispatcher ? { dispatcher } : {}) });
    } catch (error) {
      const network = networkFailure(error, url, Boolean(proxyUrl));
      fail(errorCode, network.message, network.details);
    }
    const value = await response.json().catch(() => ({}));
    if (!response.ok) fail(errorCode, value?.message || value?.code || "钉钉请求失败。", value);
    return value;
  }

  async function exchangeCode(code) {
    const value = await requestJson(`${apiBaseUrl}/v1.0/oauth2/userAccessToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret, grantType: "authorization_code", code }),
    }, "DINGTALK_TOKEN_EXCHANGE_FAILED");
    const token = value.accessToken || value.access_token;
    if (!token) fail("DINGTALK_TOKEN_EXCHANGE_FAILED", "钉钉没有返回用户访问令牌。", value);
    return { accessToken: token, refreshToken: value.refreshToken || value.refresh_token || null, expireIn: value.expireIn || value.expires_in || 7200, scope: value.scope || null };
  }

  async function loadIdentity(token) {
    const endpoints = [
      `${apiBaseUrl}/v1.0/contact/users/me`,
      `${apiBaseUrl}/v1.0/oauth2/userinfo`,
      `${apiBaseUrl}/v1.0/me`,
    ];
    let lastDetails = null;
    let lastNetwork = null;
    for (const endpoint of endpoints) {
      let response;
      try {
        response = await fetchImpl(endpoint, {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-acs-dingtalk-access-token": token,
            Accept: "application/json",
          },
          ...(dispatcher ? { dispatcher } : {}),
        });
      } catch (error) {
        lastNetwork = networkFailure(error, endpoint, Boolean(proxyUrl));
        lastDetails = lastNetwork.details;
        continue;
      }
      const value = await response.json().catch(() => ({}));
      if (!response.ok) { lastDetails = value; continue; }
      try {
        const identity = normalizeDingTalkIdentity(value.result || value.data || value);
        return await enrichOrganizationIdentity(identity);
      }
      catch (error) { if (error instanceof DingTalkAuthError) lastDetails = error.details; else throw error; }
    }
    if (lastNetwork) fail("DINGTALK_IDENTITY_REQUEST_FAILED", lastNetwork.message, lastNetwork.details);
    fail("DINGTALK_IDENTITY_REQUEST_FAILED", "无法取得当前钉钉组织用户信息。", lastDetails);
  }

  async function legacyRequest(pathname, { method = "POST", body } = {}) {
    const token = await getAppAccessToken();
    const endpoint = `${legacyApiBaseUrl}${pathname}${pathname.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
    let response;
    try { response = await fetchImpl(endpoint, { method, headers: { "Content-Type": "application/json", Accept: "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), ...(dispatcher ? { dispatcher } : {}) }); }
    catch (error) { const network = networkFailure(error, legacyApiBaseUrl, Boolean(proxyUrl)); fail("DINGTALK_ORGANIZATION_SYNC_FAILED", network.message, network.details); }
    const value = await response.json().catch(() => ({}));
    if (!response.ok || Number(value.errcode || 0) !== 0) fail("DINGTALK_ORGANIZATION_SYNC_FAILED", value.errmsg || value.message || value.code || "钉钉组织信息同步失败。", value);
    return value.result || value;
  }

  async function getAppAccessToken() {
    if (tokenManager) {
      try { return (await tokenManager.getAppAccessToken()).accessToken; } catch (error) { if (error.code !== "DINGTALK_NOT_CONNECTED") throw error; }
    }
    if (appAccessToken?.expiresAt > now().getTime() + 60_000) return appAccessToken.value;
    const query = new URLSearchParams({ appkey: clientId, appsecret: clientSecret });
    let response;
    try { response = await fetchImpl(`${legacyApiBaseUrl}/gettoken?${query}`, dispatcher ? { dispatcher } : {}); }
    catch (error) { const network = networkFailure(error, legacyApiBaseUrl, Boolean(proxyUrl)); fail("DINGTALK_ORGANIZATION_SYNC_FAILED", network.message, network.details); }
    const value = await response.json().catch(() => ({}));
    if (!response.ok || Number(value.errcode || 0) !== 0 || !value.access_token) fail("DINGTALK_ORGANIZATION_SYNC_FAILED", value.errmsg || "无法取得钉钉应用访问凭证。", value);
    appAccessToken = { value: value.access_token, expiresAt: now().getTime() + Number(value.expires_in || 7200) * 1000 };
    if (tokenManager) await tokenManager.saveAppToken({ access_token: value.access_token, expires_in: value.expires_in || 7200 });
    return appAccessToken.value;
  }

  async function enrichOrganizationIdentity(identity) {
    if (!identity.dingtalkUnionId) return identity;
    try {
      const userReference = await legacyRequest("/topapi/user/getbyunionid", { body: { unionid: identity.dingtalkUnionId } });
      const userId = first(userReference.userid, userReference.userId) || identity.dingtalkUserId;
      const detail = await legacyRequest("/topapi/v2/user/get", { body: { userid: userId, language: "zh_CN" } });
      const departmentIds = Array.isArray(detail.dept_id_list) ? detail.dept_id_list : identity.departmentIds;
      let departmentName = identity.departmentName;
      if (departmentIds?.[0] != null) {
        const department = await legacyRequest("/topapi/v2/department/get", { body: { dept_id: departmentIds[0], language: "zh_CN" } });
        departmentName = first(department.name, department.dept_name) || departmentName;
      }
      return {
        ...identity,
        dingtalkUserId: first(detail.userid, detail.userId, userId) || identity.dingtalkUserId,
        dingtalkUnionId: first(detail.unionid, detail.unionId, identity.dingtalkUnionId),
        displayName: first(detail.name, identity.displayName) || identity.displayName,
        managerUserId: first(detail.manager_userid, detail.managerUserid, identity.managerUserId),
        departmentIds: departmentIds || [],
        departmentName,
        active: detail.active !== false && identity.active,
        organizationSynced: true,
      };
    } catch {
      return { ...identity, organizationSynced: false };
    }
  }

  return {
    async checkConnectivity() {
      const checkedAt = now().toISOString();
      if (proxyConfigError) return { reachable: false, checkedAt, proxyConfigured: true, error: { code: "DINGTALK_PROXY_INVALID", message: "钉钉代理地址无效，请检查 DINGTALK_HTTPS_PROXY。" } };
      try {
        const response = await fetchImpl(`${apiBaseUrl}/`, { method: "HEAD", ...(dispatcher ? { dispatcher } : {}) });
        return { reachable: true, checkedAt, proxyConfigured: Boolean(proxyUrl), endpoint: apiBaseUrl, status: response.status };
      } catch (error) {
        const network = networkFailure(error, apiBaseUrl, Boolean(proxyUrl));
        return { reachable: false, checkedAt, proxyConfigured: Boolean(proxyUrl), endpoint: apiBaseUrl, error: { code: network.code, message: network.message, details: network.details } };
      }
    },
    startLogin() {
      requireConfigured();
      const state = crypto.randomBytes(24).toString("base64url");
      sessions.set(state, { expiresAt: now().getTime() + sessionTtlMs });
      const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: scopes, state });
      return { authorizationUrl: `${authorizeUrl}?${query}` };
    },
    async completeLogin({ code, state, error } = {}) {
      requireConfigured();
      if (error) fail("DINGTALK_OAUTH_DENIED", "钉钉授权未完成。", { error });
      const session = sessions.get(state);
      sessions.delete(state);
      if (!code || !session || session.expiresAt < now().getTime()) fail("DINGTALK_OAUTH_STATE_INVALID", "钉钉登录会话已失效，请重新登录。");
      const exchanged = await exchangeCode(code);
      const identity = await loadIdentity(exchanged.accessToken);
      if (tokenManager) await tokenManager.saveUserExchange(identity.dingtalkUserId, exchanged);
      return identity;
    },
  };
}
