import assert from "node:assert/strict";
import test from "node:test";
import { createDingTalkTokenManager } from "../shared/dingtalk-token-manager.mjs";

test("refreshes from the provider expiry and coalesces concurrent refreshes", async () => {
  let current = { accessToken: "old", refreshToken: "refresh", expiresAt: "2026-08-13T00:01:00.000Z" };
  let calls = 0;
  const manager = createDingTalkTokenManager({
    now: () => new Date("2026-08-13T00:00:00.000Z"),
    store: { get: async () => current, set: async (_key, value) => { current = value; } },
    requestToken: async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return { access_token: "new", refresh_token: "refresh-2", expires_in: 3_600 }; },
  });
  const [first, second] = await Promise.all([manager.getUserAccessToken("u"), manager.getUserAccessToken("u")]);
  assert.equal(first.accessToken, "new");
  assert.equal(second.accessToken, "new");
  assert.equal(calls, 1);
  assert.equal(current.expiresIn, 3_600);
});

test("refreshes once after an API reports an expired token", async () => {
  let current = { accessToken: "old", refreshToken: "refresh", expiresAt: "2026-08-13T01:00:00.000Z" };
  const manager = createDingTalkTokenManager({
    now: () => new Date("2026-08-13T00:00:00.000Z"),
    store: { get: async () => current, set: async (_key, value) => { current = value; } },
    requestToken: async () => ({ access_token: "new", refresh_token: "refresh", expires_in: 7_200 }),
  });
  let attempts = 0;
  const result = await manager.withUserAccessToken("u", async (token) => { attempts += 1; if (attempts === 1) throw Object.assign(new Error("expired"), { status: 401 }); return token; });
  assert.equal(result, "new");
  assert.equal(attempts, 2);
});
