import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDingTalkIdentity, createDingTalkAuthService } from "../team-server/dingtalk-auth.mjs";

test("normalizes a DingTalk organization identity", () => {
  assert.deepEqual(normalizeDingTalkIdentity({ userid: "u-1", unionid: "union-1", name: "小王", avatar: "https://example.com/avatar.png", deptList: [{ id: 10, name: "研发" }], managerUserId: "u-0" }), {
    dingtalkUserId: "u-1",
    dingtalkUnionId: "union-1",
    displayName: "小王",
    avatarUrl: "https://example.com/avatar.png",
    departmentName: "研发",
    managerUserId: "u-0",
    departmentIds: [10],
    active: true,
  });
});

test("keeps OAuth openId separate from the enterprise userid", () => {
  assert.deepEqual(normalizeDingTalkIdentity({ openId: "open-1", unionId: "union-1", nick: "Charles" }), {
    dingtalkUserId: null,
    dingtalkUnionId: "union-1",
    displayName: "Charles",
    avatarUrl: null,
    departmentName: undefined,
    managerUserId: undefined,
    departmentIds: [],
    active: true,
  });
});

test("resolves and returns the enterprise userid from unionId", async () => {
  const service = createDingTalkAuthService({
    config: { clientId: "app", clientSecret: "secret", redirectUri: "http://localhost/callback" },
    tokenManager: {
      getAppAccessToken: async () => ({ accessToken: "app-token" }),
      saveUserExchange: async () => {},
    },
    fetchImpl: async (url) => {
      if (url.includes("userAccessToken")) return { ok: true, json: async () => ({ accessToken: "user-token" }) };
      if (url.includes("contact/users/me")) return { ok: true, json: async () => ({ openId: "open-1", unionId: "union-1", nick: "Charles" }) };
      if (url.includes("user/getbyunionid")) return { ok: true, json: async () => ({ errcode: 0, result: { userid: "16327544446086901" } }) };
      if (url.includes("v2/user/get")) return { ok: true, json: async () => ({ errcode: 0, result: { userid: "16327544446086901", unionid: "union-1", name: "Charles", dept_id_list: [] } }) };
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  const started = service.startLogin();
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  const identity = await service.completeLogin({ code: "code", state });
  assert.equal(identity.dingtalkUserId, "16327544446086901");
  assert.equal(identity.dingtalkUnionId, "union-1");
  assert.equal(identity.organizationSynced, true);
});

test("renews an expired app token before resolving the enterprise userid", async () => {
  let savedAppToken = null;
  const service = createDingTalkAuthService({
    config: { clientId: "app", clientSecret: "secret", redirectUri: "http://localhost/callback" },
    tokenManager: {
      getAppAccessToken: async () => { throw Object.assign(new Error("expired"), { code: "DINGTALK_TOKEN_EXPIRED" }); },
      saveAppToken: async (value) => { savedAppToken = value; },
      saveUserExchange: async () => {},
    },
    fetchImpl: async (url, options = {}) => {
      if (url.includes("userAccessToken")) return { ok: true, json: async () => ({ accessToken: "user-token" }) };
      if (url.includes("contact/users/me")) return { ok: true, json: async () => ({ openId: "open-1", unionId: "union-1", nick: "Charles" }) };
      if (url.endsWith("/v1.0/oauth2/accessToken")) {
        assert.deepEqual(JSON.parse(options.body), { appKey: "app", appSecret: "secret", grantType: "client_credentials" });
        return { ok: true, json: async () => ({ accessToken: "fresh-app-token", expireIn: 7200 }) };
      }
      if (url.includes("user/getbyunionid")) {
        assert.match(url, /access_token=fresh-app-token/);
        return { ok: true, json: async () => ({ errcode: 0, result: { userid: "16327544446086901" } }) };
      }
      if (url.includes("v2/user/get")) return { ok: true, json: async () => ({ errcode: 0, result: { userid: "16327544446086901", unionid: "union-1", name: "Charles", dept_id_list: [] } }) };
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  const started = service.startLogin();
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  const identity = await service.completeLogin({ code: "code", state });
  assert.equal(identity.dingtalkUserId, "16327544446086901");
  assert.deepEqual(savedAppToken, { accessToken: "fresh-app-token", expireIn: 7200 });
});

test("surfaces DingTalk IP whitelist failures with a safe actionable message", async () => {
  const service = createDingTalkAuthService({
    config: { clientId: "app", clientSecret: "secret", redirectUri: "http://localhost/callback" },
    tokenManager: { getAppAccessToken: async () => ({ accessToken: "app-token" }) },
    fetchImpl: async (url) => {
      if (url.includes("userAccessToken")) return { ok: true, json: async () => ({ accessToken: "user-token" }) };
      if (url.includes("contact/users/me")) return { ok: true, json: async () => ({ openId: "open-1", unionId: "union-1", nick: "Charles" }) };
      if (url.includes("user/getbyunionid")) return { ok: true, json: async () => ({ errcode: 88, errmsg: "ding talk error[subcode=60020,submsg=访问ip不在白名单之中,request ip=14.153.172.241 appKey(ding-example)]" }) };
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  const started = service.startLogin();
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  await assert.rejects(() => service.completeLogin({ code: "code", state }), (failure) => {
    assert.equal(failure.code, "DINGTALK_IP_NOT_WHITELISTED");
    assert.match(failure.message, /14\.153\.172\.241/);
    assert.match(failure.message, /钉钉开放平台/);
    assert.equal(failure.details.requestIp, "14.153.172.241");
    assert.equal("appKey" in failure.details, false);
    return true;
  });
});

test("rejects OAuth identity without persisting openId for other organization failures", async () => {
  const service = createDingTalkAuthService({
    config: { clientId: "app", clientSecret: "secret", redirectUri: "http://localhost/callback" },
    tokenManager: { getAppAccessToken: async () => ({ accessToken: "app-token" }) },
    fetchImpl: async (url) => {
      if (url.includes("userAccessToken")) return { ok: true, json: async () => ({ accessToken: "user-token" }) };
      if (url.includes("contact/users/me")) return { ok: true, json: async () => ({ openId: "open-1", unionId: "union-1", nick: "Charles" }) };
      if (url.includes("user/getbyunionid")) return { ok: true, json: async () => ({ errcode: 400, errmsg: "organization lookup failed" }) };
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  const started = service.startLogin();
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  await assert.rejects(() => service.completeLogin({ code: "code", state }), {
    code: "DINGTALK_ORGANIZATION_USERID_REQUIRED",
  });
});

test("DingTalk login exchanges code and validates state", async () => {
  const calls = [];
  const service = createDingTalkAuthService({
    config: { clientId: "app", clientSecret: "secret", redirectUri: "http://localhost/callback" },
    now: () => new Date("2026-08-12T00:00:00Z"),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => url.includes("userAccessToken") ? { accessToken: "token" } : { userid: "u-1", name: "小王", managerUserId: "u-0" } };
    },
  });
  const started = service.startLogin();
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  const identity = await service.completeLogin({ code: "code", state });
  assert.equal(identity.dingtalkUserId, "u-1");
  assert.equal(calls.length, 2);
  await assert.rejects(() => service.completeLogin({ code: "code", state }), { code: "DINGTALK_OAUTH_STATE_INVALID" });
});

test("classifies blocked DingTalk network access and exposes a safe connectivity check", async () => {
  const service = createDingTalkAuthService({
    config: { clientId: "app", clientSecret: "secret", redirectUri: "http://localhost/callback" },
    fetchImpl: async (_url, options = {}) => {
      assert.equal(options.dispatcher, undefined);
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    },
  });
  const started = service.startLogin();
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  await assert.rejects(() => service.completeLogin({ code: "code", state }), (failure) => {
    assert.equal(failure.code, "DINGTALK_TOKEN_EXCHANGE_FAILED");
    assert.match(failure.message, /DINGTALK_HTTPS_PROXY/);
    assert.equal(failure.details.cause, "EACCES");
    assert.equal("clientSecret" in failure.details, false);
    return true;
  });
  const check = await service.checkConnectivity();
  assert.equal(check.reachable, false);
  assert.equal(check.error.code, "DINGTALK_NETWORK_ERROR");
});

test("rejects an invalid DingTalk proxy before opening OAuth", () => {
  const service = createDingTalkAuthService({ config: { clientId: "app", clientSecret: "secret", redirectUri: "http://localhost/callback", proxyUrl: "not-a-url" } });
  assert.throws(() => service.startLogin(), { code: "DINGTALK_PROXY_INVALID" });
});
