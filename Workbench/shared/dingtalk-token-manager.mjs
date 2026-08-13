const DEFAULT_EXPIRES_IN_SECONDS = 7_200;
const DEFAULT_REFRESH_WINDOW_MS = 5 * 60 * 1_000;

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function tokenFrom(value, now, fallbackExpiresIn = DEFAULT_EXPIRES_IN_SECONDS) {
  const accessToken = value?.accessToken || value?.access_token;
  if (!accessToken) throw new Error("DingTalk did not return an access token.");
  const expiresIn = number(value.expireIn || value.expires_in, fallbackExpiresIn);
  return {
    accessToken,
    refreshToken: value.refreshToken || value.refresh_token || null,
    expiresAt: new Date(now().getTime() + expiresIn * 1_000).toISOString(),
    expiresIn,
    scope: value.scope || null,
    refreshedAt: now().toISOString(),
  };
}

export function createDingTalkTokenManager({ store, requestToken, now = () => new Date(), refreshWindowMs = DEFAULT_REFRESH_WINDOW_MS } = {}) {
  if (!store?.get || !store?.set) throw new TypeError("A token store is required.");
  const flights = new Map();

  function needsRefresh(token) {
    const expiresAt = Date.parse(token?.expiresAt || "");
    return !Number.isFinite(expiresAt) || expiresAt - now().getTime() <= refreshWindowMs;
  }

  async function refresh(key, token) {
    if (!token?.refreshToken) {
      const error = Object.assign(new Error("DingTalk authorization has expired; reconnect is required."), { code: "DINGTALK_TOKEN_EXPIRED" });
      throw error;
    }
    if (!flights.has(key)) {
      flights.set(key, (async () => {
        const next = tokenFrom(await requestToken({ grantType: "refresh_token", refreshToken: token.refreshToken }), now);
        await store.set(key, next);
        return next;
      })().finally(() => flights.delete(key)));
    }
    return flights.get(key);
  }

  async function get(key, { refresh: shouldRefresh = true } = {}) {
    const token = await store.get(key);
    if (!token?.accessToken) {
      const error = Object.assign(new Error("DingTalk authorization is not connected."), { code: "DINGTALK_NOT_CONNECTED" });
      throw error;
    }
    return shouldRefresh && needsRefresh(token) ? refresh(key, token) : token;
  }

  async function saveExchange(key, value) {
    const token = tokenFrom(value, now);
    await store.set(key, token);
    return token;
  }

  async function withAccessToken(key, operation) {
    let token = await get(key);
    try {
      return await operation(token.accessToken, token);
    } catch (error) {
      if (!error?.tokenExpired && ![401, 403].includes(Number(error?.status))) throw error;
      token = await refresh(key, token);
      return operation(token.accessToken, token);
    }
  }

  return {
    getUserAccessToken: (subject) => get(`user:${subject}`),
    getAppAccessToken: () => get("app"),
    saveUserExchange: (subject, value) => saveExchange(`user:${subject}`, value),
    saveAppToken: (value) => saveExchange("app", value),
    refreshUserAccessToken: async (subject) => { const key = `user:${subject}`; const token = await store.get(key); return refresh(key, token); },
    withUserAccessToken: (subject, operation) => withAccessToken(`user:${subject}`, operation),
    invalidateToken: async (subject) => store.delete?.(`user:${subject}`),
    needsRefresh,
  };
}

export { tokenFrom as normalizeDingTalkToken, DEFAULT_EXPIRES_IN_SECONDS, DEFAULT_REFRESH_WINDOW_MS };
