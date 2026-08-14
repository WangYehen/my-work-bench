import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createIdentityContext } from "../server/identity-context.mjs";

const now = () => new Date("2026-08-13T03:00:00.000Z");
const loginProfile = () => ({ id: "1001", dingtalkUserId: "1001", displayName: "Hollis", managerUserId: "999", departmentIds: ["200"], departmentName: "IT Dept." });
const orgProfile = () => ({
  id: "1001",
  dingtalkUserId: "1001",
  displayName: "Hollis",
  managerUserId: "999",
  departmentIds: ["200"],
  organizationSynced: true,
  departments: [
    { id: "200", name: "IT Dept.", parentId: "1" },
    { id: "201", name: "Backend Development Group", parentId: "200" },
    { id: "202", name: "Frontend Development Group", parentId: "200" },
  ],
  organizationMembers: [
    { id: "1001", displayName: "Hollis", managerUserId: "999", departmentIds: ["200"] },
    { id: "1002", displayName: "Charles", managerUserId: "1001", departmentIds: ["201", "202"] },
    { id: "1003", displayName: "Alice", managerUserId: "1001", departmentIds: ["202"] },
    { id: "1004", displayName: "Deep", managerUserId: "1002", departmentIds: ["201"] },
    // 同部门的非下属（上级 999 之下、与 Hollis 平级）不得被授权
    { id: "1005", displayName: "Peer", managerUserId: "999", departmentIds: ["201"] },
  ],
});

test("organization sync keeps only recursive subordinates with multi-department memberships", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workbench-identity-org-"));
  const ctx = createIdentityContext({ dbPath: path.join(directory, "workbench.sqlite"), now });
  t.after(async () => { ctx.close(); await rm(directory, { recursive: true, force: true }); });
  const loggedIn = ctx.sync(loginProfile());
  assert.equal(loggedIn.canViewTeamReports, false);
  const stats = ctx.applyOrganization(orgProfile());
  assert.deepEqual(stats, { departmentCount: 3, memberCount: 3 });
  const manager = ctx.current(loginProfile());
  assert.equal(manager.organizationSynced, true);
  assert.equal(manager.canViewTeamReports, true);
  assert.equal(manager.subordinateCount, 3);
  assert.deepEqual(manager.visibleIdentityIds, ["dingtalk:1001", "dingtalk:1002", "dingtalk:1003", "dingtalk:1004"]);
  const dashboard = ctx.dashboard(manager, { date: "2026-08-13" });
  assert.deepEqual(new Set(dashboard.members.map((member) => member.id)), new Set(["dingtalk:1002", "dingtalk:1003", "dingtalk:1004"]));
  const charles = dashboard.members.find((member) => member.id === "dingtalk:1002");
  assert.deepEqual(charles.departmentIds, ["dingtalk-dept:201", "dingtalk-dept:202"]);
  assert.deepEqual(charles.departmentNames, ["Backend Development Group", "Frontend Development Group"]);
  assert.equal(charles.departmentName, "Backend Development Group");
  assert.deepEqual(dashboard.departments.map((department) => department.name), ["Backend Development Group", "Frontend Development Group"]);
  assert.equal(dashboard.departments.find((department) => department.id === "dingtalk-dept:201").memberCount, 2);
});

test("department filter uses department ids and dashboards show multi-department separators", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workbench-identity-filter-"));
  const ctx = createIdentityContext({ dbPath: path.join(directory, "workbench.sqlite"), now });
  t.after(async () => { ctx.close(); await rm(directory, { recursive: true, force: true }); });
  ctx.sync(loginProfile());
  ctx.applyOrganization(orgProfile());
  const manager = ctx.current(loginProfile());
  ctx.saveReports([
    { creatorId: "1002", creatorName: "Charles", reportDate: "2026-08-13", remark: "完成后端联调", completedItems: "任务 B", nextActions: "任务 C", createTime: "2026-08-13T10:00:00.000Z", blockers: "测试环境接口不稳定", cooperationNeeds: "需要确认数据权限方案" },
    { creatorId: "1003", creatorName: "Alice", reportDate: "2026-08-13", remark: "完成前端页面", completedItems: "任务 D", blockers: "测试环境接口不稳定", cooperationNeeds: "需要协调测试资源" },
  ]);
  const all = ctx.dashboard(manager, { date: "2026-08-13" });
  assert.equal(all.metrics.submitted, 2);
  assert.equal(all.metrics.expected, 3);
  assert.equal(all.metrics.missing, 1);
  // dashboard 日报明细应展开 raw_payload_ref 中的阻塞/协作字段
  const aliceReport = all.reports.find((report) => report.ownerIdentityId === "dingtalk:1003");
  assert.equal(aliceReport.blockers, "测试环境接口不稳定");
  assert.equal(aliceReport.cooperationNeeds, "需要协调测试资源");
  const backend = ctx.dashboard(manager, { date: "2026-08-13", departmentId: "dingtalk-dept:201" });
  assert.deepEqual(backend.members.map((member) => member.id), ["dingtalk:1002", "dingtalk:1004"]);
  assert.equal(backend.metrics.expected, 2);
  const charlesReport = backend.reports.find((report) => report.ownerIdentityId === "dingtalk:1002");
  assert.equal(charlesReport.departmentNames, "Backend Development Group · Frontend Development Group");
});

test("organization re-sync deactivates members that no longer appear and clears their departments", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workbench-identity-resync-"));
  const ctx = createIdentityContext({ dbPath: path.join(directory, "workbench.sqlite"), now });
  t.after(async () => { ctx.close(); await rm(directory, { recursive: true, force: true }); });
  ctx.sync(loginProfile());
  ctx.applyOrganization(orgProfile());
  const nextProfile = orgProfile();
  // 下一轮 Alice 与 Deep 不再可见，仅 Charles 保留
  nextProfile.organizationMembers = nextProfile.organizationMembers.filter((member) => ["1001", "1002"].includes(member.id));
  ctx.applyOrganization(nextProfile);
  const manager = ctx.current(loginProfile());
  assert.equal(manager.subordinateCount, 1);
  const dashboard = ctx.dashboard(manager, { date: "2026-08-13" });
  assert.deepEqual(dashboard.members.map((member) => member.id), ["dingtalk:1002"]);
  const statuses = ctx.descendants(manager.id);
  assert.deepEqual(statuses, ["dingtalk:1002"]);
});

test("dashboard stays readable after a failed refresh because the last graph is retained", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workbench-identity-degrade-"));
  const ctx = createIdentityContext({ dbPath: path.join(directory, "workbench.sqlite"), now });
  t.after(async () => { ctx.close(); await rm(directory, { recursive: true, force: true }); });
  ctx.sync(loginProfile());
  ctx.applyOrganization(orgProfile());
  // 模拟同步失败：不调用 applyOrganization，先前入库的授权图应保持可用
  const manager = ctx.current(loginProfile());
  assert.equal(manager.canViewTeamReports, true);
  assert.equal(ctx.dashboard(manager, { date: "2026-08-13" }).members.length, 3);
});

test("dashboard forbids members without authorized subordinates", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workbench-identity-forbidden-"));
  const ctx = createIdentityContext({ dbPath: path.join(directory, "workbench.sqlite"), now });
  t.after(async () => { ctx.close(); await rm(directory, { recursive: true, force: true }); });
  const loggedIn = ctx.sync(loginProfile());
  assert.equal(loggedIn.canViewTeamReports, false);
  assert.throws(() => ctx.dashboard(loggedIn, { date: "2026-08-13" }), { code: "TEAM_REPORT_FORBIDDEN" });
});