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
    if (String(url).includes("/topapi/user/getbyunionid")) return response({ result: { userid: "1001" } });
    if (String(url).includes("/topapi/v2/user/get")) return response({ result: { userid: "1001", name: "Hollis", dept_id_list: [] } });
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

// 登录仅同步当前身份；组织树由独立的 syncOrganization 操作补全，避免 OAuth 回调超时。
test("completeOAuth does not pull the organization tree on login", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workbench-dingtalk-org-"));
  t.after(async () => {
    // 登录触发的后台同步可能仍在写状态文件，重试清理避免 ENOTEMPTY。
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { await rm(directory, { recursive: true, force: true }); return; }
      catch (error) { if (error.code !== "ENOTEMPTY") throw error; await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
  });
  const bodyOf = (options) => { try { return JSON.parse(String(options?.body || "{}")); } catch { return {}; } };
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    calls.push(target);
    const body = bodyOf(options);
    const ok = (value) => ({ ok: true, status: 200, json: async () => value });
    if (target.endsWith("/v1.0/oauth2/userAccessToken")) return ok({ accessToken: "utoken", refreshToken: "rtoken", expireIn: 7200 });
    if (target.endsWith("/v1.0/oauth2/accessToken")) return ok({ accessToken: "atoken", expireIn: 7200 });
    if (target.includes("/contact/users/me")) return ok({ unionId: "union-1" });
    if (target.includes("/topapi/user/getbyunionid")) return ok({ result: { userid: "1001" } });
    if (target.includes("/topapi/v2/user/get")) {
      const members = {
        "1001": { userid: "1001", name: "Hollis", avatar: "a", manager_userid: "999", dept_id_list: [200] },
        "1002": { userid: "1002", name: "Charles", avatar: "b", manager_userid: "1001", dept_id_list: [201] },
        "1003": { userid: "1003", name: "Alice", avatar: "c", manager_userid: "1001", dept_id_list: [202] },
      };
      return ok({ result: members[String(body.userid)] || { userid: String(body.userid), name: "未知" } });
    }
    if (target.includes("/topapi/v2/department/get")) {
      const departments = {
        200: { dept_id: 200, name: "IT Dept.", parent_id: 1 },
        201: { dept_id: 201, name: "Backend Development Group", parent_id: 200 },
        202: { dept_id: 202, name: "Frontend Development Group", parent_id: 200 },
      };
      return ok({ result: departments[Number(body.dept_id)] || { dept_id: Number(body.dept_id), name: "未知部门" } });
    }
    if (target.includes("/topapi/user/listid")) {
      const lists = { "200": ["1001"], "201": ["1002"], "202": ["1003"] };
      return ok({ result: { userid_list: lists[String(body.dept_id)] || [] } });
    }
    if (target.includes("/topapi/v2/department/listsubid")) {
      const children = { "200": [201, 202] };
      return ok({ result: { dept_id_list: children[String(body.dept_id)] || [] } });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const service = createDingTalkService({
    config: { clientId: "app-key", clientSecret: "secret", redirectUri: "http://127.0.0.1/callback", tokenEncryptionKey: Buffer.alloc(32, 1).toString("base64") },
    stateDirectory: directory, fetchImpl, now: () => new Date("2026-08-13T03:00:00.000Z"), startScheduler: false,
  });
  const authorization = await service.startOAuth();
  const state = new URL(authorization.authorizationUrl).searchParams.get("state");
  await service.completeOAuth({ code: "code", state });
  const profile = (await service.status()).profile;
  assert.equal(profile.organizationSynced, false);
  assert.deepEqual(profile.organizationMembers, []);
  assert.equal(calls.some((target) => target.includes("/topapi/user/listid")), false);
  assert.equal(calls.some((target) => target.includes("/topapi/v2/department/listsubid")), false);
});

// 后台组织同步通过 organizationProfile 获取完整组织图，且不写加密状态（避免超过 4MB 存储上限）。
test("organizationProfile returns the full tree with department names and does not write state", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workbench-dingtalk-orgprofile-"));
  t.after(async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { await rm(directory, { recursive: true, force: true }); return; }
      catch (error) { if (error.code !== "ENOTEMPTY") throw error; await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
  });
  const bodyOf = (options) => { try { return JSON.parse(String(options?.body || "{}")); } catch { return {}; } };
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    const body = bodyOf(options);
    const ok = (value) => ({ ok: true, status: 200, json: async () => value });
    if (target.endsWith("/v1.0/oauth2/userAccessToken")) return ok({ accessToken: "utoken", refreshToken: "rtoken", expireIn: 7200 });
    if (target.endsWith("/v1.0/oauth2/accessToken")) return ok({ accessToken: "atoken", expireIn: 7200 });
    if (target.includes("/contact/users/me")) return ok({ unionId: "union-1" });
    if (target.includes("/topapi/user/getbyunionid")) return ok({ result: { userid: "1001" } });
    if (target.includes("/topapi/v2/user/get")) {
      const members = {
        "1001": { userid: "1001", name: "Hollis", avatar: "a", manager_userid: "999", dept_id_list: [200] },
        "1002": { userid: "1002", name: "Charles", avatar: "b", manager_userid: "1001", dept_id_list: [201, 202] },
        "1003": { userid: "1003", name: "Alice", avatar: "c", manager_userid: "1001", dept_id_list: [202] },
      };
      return ok({ result: members[String(body.userid)] || { userid: String(body.userid), name: "未知" } });
    }
    if (target.includes("/topapi/v2/department/get")) {
      const departments = {
        200: { dept_id: 200, name: "IT Dept.", parent_id: 1 },
        201: { dept_id: 201, name: "Backend Development Group", parent_id: 200 },
        202: { dept_id: 202, name: "Frontend Development Group", parent_id: 200 },
      };
      return ok({ result: departments[Number(body.dept_id)] || { dept_id: Number(body.dept_id), name: "未知部门" } });
    }
    if (target.includes("/topapi/user/listid")) {
      const lists = { "200": ["1001"], "201": ["1002"], "202": ["1003"] };
      return ok({ result: { userid_list: lists[String(body.dept_id)] || [] } });
    }
    if (target.includes("/topapi/v2/department/listsubid")) {
      const children = { "200": [201, 202] };
      return ok({ result: { dept_id_list: children[String(body.dept_id)] || [] } });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const service = createDingTalkService({
    config: { clientId: "app-key", clientSecret: "secret", redirectUri: "http://127.0.0.1/callback", tokenEncryptionKey: Buffer.alloc(32, 1).toString("base64") },
    stateDirectory: directory, fetchImpl, now: () => new Date("2026-08-13T03:00:00.000Z"), startScheduler: false,
  });
  const authorization = await service.startOAuth();
  const state = new URL(authorization.authorizationUrl).searchParams.get("state");
  await service.completeOAuth({ code: "code", state });
  const orgProfile = await service.organizationProfile();
  assert.equal(orgProfile.organizationSynced, true);
  // 部门按批次并发遍历，成员/部门收集顺序不固定，按集合比较
  assert.deepEqual(new Set(orgProfile.organizationMembers.map((member) => member.id)), new Set(["1001", "1002", "1003"]));
  const charles = orgProfile.organizationMembers.find((member) => member.id === "1002");
  assert.deepEqual(charles.departmentIds, ["201", "202"]);
  assert.equal(charles.managerUserId, "1001");
  const departments = orgProfile.departments;
  assert.deepEqual(new Set(departments.map((department) => department.id)), new Set(["200", "201", "202"]));
  assert.equal(departments.find((department) => department.id === "200").name, "IT Dept.");
  assert.equal(departments.find((department) => department.id === "201").parentId, "200");
  assert.equal(departments.find((department) => department.id === "202").parentId, "200");
  // 组织图不落加密状态，登录保存的仍是轻量身份
  const statusProfile = (await service.status()).profile;
  assert.equal(statusProfile.organizationSynced, false);
  assert.deepEqual(statusProfile.organizationMembers, []);
});
