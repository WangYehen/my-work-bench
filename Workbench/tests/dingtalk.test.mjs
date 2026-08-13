import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeDingTalkEvent, createDingTalkService } from "../server/dingtalk.mjs";

test("normalizes DingTalk calendar events into the workbench shape", () => {
  const event = normalizeDingTalkEvent({ id: "e1", subject: "周会", start: { dateTime: "2026-08-12T02:30:00.000Z" }, end: { dateTime: "2026-08-12T03:00:00.000Z" }, location: { displayName: "会议室 A" }, attendees: [{ name: "小王" }], onlineMeeting: { joinUrl: "https://example.com/meeting" } });
  assert.deepEqual(event, { id: "e1", title: "周会", startAt: "2026-08-12T02:30:00.000Z", endAt: "2026-08-12T03:00:00.000Z", isAllDay: false, location: "会议室 A", organizer: null, attendees: ["小王"], meetingUrl: "https://example.com/meeting", source: "dingtalk" });
});

test("reports DingTalk configuration without exposing secrets", async () => {
  const service = createDingTalkService({ config: {}, stateDirectory: ".local/test-dingtalk" });
  const status = await service.status();
  assert.equal(status.configured, false);
  assert.ok(status.missingConfiguration.includes("DINGTALK_CLIENT_SECRET"));
  assert.equal("clientSecret" in status, false);
});

test("syncs resources independently, deduplicates flights, and treats empty todos as cached", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workbench-dingtalk-sync-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [];
  const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/v1.0/oauth2/userAccessToken")) return response({ accessToken: "user-token", refreshToken: "refresh-token", expireIn: 7200 });
    if (String(url).endsWith("/v1.0/oauth2/accessToken")) return response({ accessToken: "app-token", expireIn: 7200 });
    if (String(url).includes("/contact/users/me")) return response({ unionId: "union-1" });
    if (String(url).includes("/calendar/users/")) return response({ events: [] });
    if (String(url).includes("/org/tasks/query")) return response({ items: [] });
    return response({}, 404);
  };
  const service = createDingTalkService({
    config: { clientId: "app-key", clientSecret: "secret", redirectUri: "http://127.0.0.1/callback", tokenEncryptionKey: Buffer.alloc(32, 1).toString("base64") },
    stateDirectory: directory,
    fetchImpl,
    now: () => new Date("2026-08-13T03:00:00.000Z"),
    startScheduler: false,
  });
  const authorization = await service.startOAuth();
  const state = new URL(authorization.authorizationUrl).searchParams.get("state");
  await service.completeOAuth({ code: "code", state });
  const initialTodoCalls = calls.filter((url) => url.includes("/org/tasks/query")).length;
  await service.todos();
  await service.todos();
  assert.equal(calls.filter((url) => url.includes("/org/tasks/query")).length, initialTodoCalls);
  await Promise.all([service.sync({ resources: ["todos"] }), service.sync({ resources: ["todos"] })]);
  assert.equal(calls.filter((url) => url.includes("/org/tasks/query")).length, initialTodoCalls + 1);
  const status = await service.status();
  assert.equal(status.sync.todos.lastError, null);
  assert.equal(status.sync.todos.itemCount, 0);
  assert.ok(status.sync.todos.lastSuccessAt);
  assert.ok(status.sync.events.lastSuccessAt);
});

test("keeps the last successful todo cache when a later sync fails", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workbench-dingtalk-stale-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let todoFails = false;
  const response = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/v1.0/oauth2/userAccessToken")) return response({ accessToken: "user-token", refreshToken: "refresh-token", expireIn: 7200 });
    if (String(url).endsWith("/v1.0/oauth2/accessToken")) return response({ accessToken: "app-token", expireIn: 7200 });
    if (String(url).includes("/contact/users/me")) return response({ unionId: "union-1" });
    if (String(url).includes("/calendar/users/")) return response({ events: [] });
    if (String(url).includes("/org/tasks/query")) return todoFails ? response({ code: "Forbidden", message: "denied" }, 403) : response({ items: [{ taskId: "task-1", subject: "Keep me" }] });
    return response({}, 404);
  };
  const service = createDingTalkService({
    config: { clientId: "app-key", clientSecret: "secret", redirectUri: "http://127.0.0.1/callback", tokenEncryptionKey: Buffer.alloc(32, 2).toString("base64") },
    stateDirectory: directory,
    fetchImpl,
    now: () => new Date("2026-08-13T03:00:00.000Z"),
    startScheduler: false,
  });
  const authorization = await service.startOAuth();
  const state = new URL(authorization.authorizationUrl).searchParams.get("state");
  await service.completeOAuth({ code: "code", state });
  todoFails = true;
  await assert.rejects(service.sync({ resources: ["todos"] }), { code: "DINGTALK_TODO_REQUEST_FAILED" });
  assert.equal((await service.todos())[0].title, "Keep me");
  const status = await service.status();
  assert.equal(status.sync.todos.itemCount, 1);
  assert.equal(status.sync.todos.lastError, "DINGTALK_TODO_REQUEST_FAILED");
  assert.ok(status.sync.todos.lastSuccessAt);
});
