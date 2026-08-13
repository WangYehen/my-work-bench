import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDingTalkIdentity, createDingTalkAuthService } from "../team-server/dingtalk-auth.mjs";

test("normalizes a DingTalk organization identity", () => {
  assert.deepEqual(normalizeDingTalkIdentity({ userid: "u-1", unionid: "union-1", name: "小王", deptList: [{ id: 10, name: "研发" }], managerUserId: "u-0" }), {
    dingtalkUserId: "u-1",
    dingtalkUnionId: "union-1",
    displayName: "小王",
    departmentName: "研发",
    managerUserId: "u-0",
    departmentIds: [10],
    active: true,
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
