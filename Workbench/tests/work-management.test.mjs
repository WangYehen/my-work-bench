import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildWeeklyReport, workSnapshot } from "../src/data/work-management.js";

test("DingTalk pages read cache on entry and expose unified manual sync", async () => {
  const [meetings, workManagement, api, service] = await Promise.all([
    readFile(new URL("../src/pages/MeetingsPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/WorkManagementPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/api.js", import.meta.url), "utf8"),
    readFile(new URL("../server/dingtalk.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(api, /export function syncDingTalk/);
  assert.match(meetings, /syncDingTalk\(\{ \.\.\.range, resources: \["events"\] \}\)/);
  assert.equal(workManagement.includes("同步钉钉"), false);
  assert.match(meetings, /DingTalkSyncStatus/);
  assert.equal(workManagement.includes("自动同步：每 1 小时"), false);
  assert.equal(meetings.includes("setInterval"), false);
  assert.equal(meetings.includes("initialLoad"), false);
  assert.equal(workManagement.includes("loadDingTalkTodos"), false);
  assert.match(service, /DEFAULT_SYNC_INTERVAL_MS = 60 \* 60 \* 1000/);
  assert.match(service, /setInterval\(\(\) => \{ void scheduledSync\(\)/);
});

test("work management demo keeps each requested work module populated", () => {
  assert.ok(workSnapshot.tasks.length > 0);
  assert.ok(workSnapshot.focus.length > 0);
  assert.ok(workSnapshot.meetings.length > 0);
  assert.ok(workSnapshot.emails.length > 0);
  assert.match(buildWeeklyReport(), /AI 摘要（本地示例）/);
});

test("work navigation exposes new modules and removes content and douyin entries", async () => {
  const [app, shell] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AppShell.jsx", import.meta.url), "utf8"),
  ]);

  for (const route of ["/todos", "/weekly-focus", "/meetings", "/outlook", "/weekly-report"]) {
    assert.match(app, new RegExp(`path=\\"${route}\\"`));
  }
  for (const route of ["/", "/weekly-focus", "/daily-report", "/weekly-report", "/team-reports", "/team-risks", "/team-weekly-report"]) assert.ok(shell.includes(`to: "${route}"`));
  assert.match(app, /TodayWorkPage/);

  assert.equal(app.includes('path="/content"'), false);
  assert.equal(app.includes('path="/douyin"'), false);
  assert.equal(shell.includes('to: "/content"'), false);
  assert.equal(shell.includes('to: "/douyin"'), false);
});

test("team report authentication is centralized in system settings", async () => {
  const [system, weekly, daily, admin] = await Promise.all([
    readFile(new URL("../src/pages/SystemPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/WorkManagementPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/DailyReportPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/TeamReportsAdminPage.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(system, /startDingTalkDailyReportLogin/);
  assert.match(system, /exchangeDingTalkDailyReportLogin/);
  assert.match(system, /logoutDailyReport/);
  assert.match(system, /system-team-auth/);
  assert.match(system, /DINGTALK_IP_NOT_WHITELISTED/);
  assert.match(system, /服务器出口 IP 白名单将在登录时继续校验/);
  assert.match(system, /replaceState\(\{\}, "", globalThis\.location\.pathname\)/);
  for (const page of [weekly, daily, admin]) {
    assert.equal(page.includes("loginDailyReport"), false);
    assert.equal(page.includes("logoutDailyReport"), false);
  }
  assert.match(admin, /直属关系加载真实团队日报/);
});

test("Outlook inbox reports real sync state and uses the shared page header", async () => {
  const [outlook, styles] = await Promise.all([
    readFile(new URL("../src/pages/OutlookPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(outlook, /<PageHeader/);
  assert.match(outlook, /title="行动收件箱"/);
  assert.match(outlook, /syncing \? "正在识别邮件…" : `已完成 /);
  assert.match(outlook, /<span>发件人与主题<\/span><span>要做什么<\/span>/);
  assert.match(outlook, /action-mail-primary/);
  assert.match(outlook, /AI 判断详情/);
  assert.match(outlook, /断开 Outlook 后将停止同步，但会保留本地邮件归档/);
  assert.equal(outlook.includes("识别中：{status.todoCount + status.uncertainCount}"), false);
  assert.match(styles, /\.action-inbox-tabs button \{[^}]*font-size: 14px/);
  assert.match(styles, /\.action-mail-row small \{[^}]*font-size: 12px/);
});

test("registered route pages use the shared header contract", async () => {
  const [header, app, styles] = await Promise.all([
    readFile(new URL("../src/components/PageHeader.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(header, /formatPageEyebrow/);
  assert.match(header, /replace\(\/\^\\s\*\\\/\\\/\\s\*\//);
  assert.match(header, /page-header__actions/);
  assert.match(header, /page-header__meta/);
  assert.equal(header.includes("aside"), false);
  assert.match(app, /path="\/books\/:bookId"/);
  assert.match(styles, /\.page-header__eyebrow/);
  assert.match(styles, /\.floating-search \{ display: none !important; \}/);
});

test("today work page offers a shared task dialog for manual tasks", async () => {
  const [todayWork, taskForm, workManagement] = await Promise.all([
    readFile(new URL("../src/pages/TodayWorkPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/TaskForm.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/WorkManagementPage.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(todayWork, /新建任务/);
  assert.match(todayWork, /TaskDialog/);
  assert.match(todayWork, /createTask\(payload\)/);
  assert.match(taskForm, /export function TaskDialog/);
  assert.match(taskForm, /export function TaskForm/);
  assert.match(taskForm, /aria-modal="true"/);
  assert.match(taskForm, /task-modal/);
  assert.equal(workManagement.includes("function TaskForm"), false);
  assert.match(workManagement, /import \{ TaskForm \} from "\.\.\/components\/TaskForm"/);
});
