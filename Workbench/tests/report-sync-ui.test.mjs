import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("today, personal report, and team report pages expose manual log sync", async () => {
  const [today, daily, team, api, electron] = await Promise.all([
    readFile(new URL("../src/pages/TodayWorkPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/DailyReportPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/TeamReportsAdminPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/daily-reports.js", import.meta.url), "utf8"),
    readFile(new URL("../electron/main.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(today, /scope: "today-work"/);
  assert.match(daily, /scope: "daily-report"/);
  assert.match(team, /scope: "team-reports"/);
  for (const source of [today, daily, team]) assert.match(source, /同步日志/);
  assert.match(api, /\/api\/local-daily-reports\/sync/);
  assert.match(api, /\/api\/local-team\/dashboard\?\$\{query\}/);
  assert.match(electron, /\/api\/local-daily-reports\/sync/);
});
