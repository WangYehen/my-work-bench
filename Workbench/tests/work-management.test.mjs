import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildWeeklyReport, workSnapshot } from "../src/data/work-management.js";

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
    assert.ok(shell.includes(`to: "${route}"`));
  }

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
  for (const page of [weekly, daily, admin]) {
    assert.equal(page.includes("loginDailyReport"), false);
    assert.equal(page.includes("logoutDailyReport"), false);
  }
  assert.match(admin, /钉钉组织权限范围/);
});
