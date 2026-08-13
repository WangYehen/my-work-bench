import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeDingTalkEvent, createDingTalkService } from "../server/dingtalk.mjs";

test("normalizes DingTalk calendar events into the workbench shape", () => {
  const event = normalizeDingTalkEvent({ id: "e1", subject: "周会", start: { dateTime: "2026-08-12T02:30:00.000Z" }, end: { dateTime: "2026-08-12T03:00:00.000Z" }, attendees: [{ name: "小王" }] });
  assert.equal(event.id, "e1");
  assert.equal(event.title, "周会");
  assert.equal(event.source, "dingtalk");
});

test("reports DingTalk configuration without exposing secrets", async () => {
  const service = createDingTalkService({ config: {}, stateDirectory: ".local/test-dingtalk" });
  const status = await service.status();
  assert.equal(status.configured, false);
  assert.ok(status.missingConfiguration.includes("DINGTALK_CLIENT_SECRET"));
  assert.equal("clientSecret" in status, false);
});

test("syncs only calendar events and rejects todo synchronization", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workbench-dingtalk-events-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [];
  const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/v1.0/oauth2/userAccessToken")) return response({ accessToken: "utoken", refreshToken: "rtoken", expireIn: 7200 });
    if (String(url).endsWith("/v1.0/oauth2/accessToken")) return response({ accessToken: "atoken", expireIn: 7200 });
    if (String(url).includes("/contact/users/me")) return response({ unionId: "union-1" });
    if (String(url).includes("/calendar/users/")) return response({ events: [] });
    return response({}, 404);
  };
  const service = createDingTalkService({
    config: { clientId: "app-key", clientSecret: "secret", redirectUri: "http://127.0.0.1/callback", tokenEncryptionKey: Buffer.alloc(32, 1).toString("base64") },
    stateDirectory: directory, fetchImpl, now: () => new Date("2026-08-13T03:00:00.000Z"), startScheduler: false,
  });
  const authorization = await service.startOAuth();
  const state = new URL(authorization.authorizationUrl).searchParams.get("state");
  await service.completeOAuth({ code: "code", state });
  await service.sync({ resources: ["events"] });
  assert.equal(calls.some((url) => url.includes("/org/tasks/query")), false);
  await assert.rejects(service.sync({ resources: ["todos"] }), { code: "DINGTALK_INVALID_SYNC_RESOURCES" });
  assert.ok((await service.status()).sync.events.lastSuccessAt);
});
