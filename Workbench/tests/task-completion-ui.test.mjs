import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("daily report reads persistent completion snapshots and labels their sources", async () => {
  const [page, api, routes, today] = await Promise.all([
    readFile(new URL("../src/pages/DailyReportPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/api.js", import.meta.url), "utf8"),
    readFile(new URL("../server/vite-plugin-workbench.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/TodayWorkPage.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /loadTaskCompletions\(reportDate\)/);
  assert.match(page, /Outlook 任务/);
  assert.match(page, /手动任务/);
  assert.match(api, /\/api\/task-completions\?date=/);
  assert.match(routes, /tasks\.listCompletions/);
  assert.match(today, /actionKind === "outlook-message"/);
  assert.doesNotMatch(today, /item\.sourceType === "outlook"/);
});
