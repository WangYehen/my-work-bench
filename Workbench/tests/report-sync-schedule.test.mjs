import test from "node:test";
import assert from "node:assert/strict";
import { dailyReportSyncRange, nextDailyReportSyncAt, startDailyReportSyncScheduler } from "../team-server/report-sync-schedule.mjs";

test("daily sync covers yesterday through today in Asia/Shanghai", () => {
  assert.deepEqual(dailyReportSyncRange(new Date("2026-08-13T00:30:00Z")), { from: "2026-08-12", to: "2026-08-13" });
});

test("next daily sync is 08:00 Asia/Shanghai", () => {
  assert.equal(nextDailyReportSyncAt(new Date("2026-08-12T23:00:00Z")).toISOString(), "2026-08-13T00:00:00.000Z");
  assert.equal(nextDailyReportSyncAt(new Date("2026-08-13T00:01:00Z")).toISOString(), "2026-08-14T00:00:00.000Z");
});

test("invalid configured hour falls back to 08:00", () => {
  assert.equal(nextDailyReportSyncAt(new Date("2026-08-12T23:00:00Z"), 99).toISOString(), "2026-08-13T00:00:00.000Z");
});

test("scheduler invokes one full-team range and schedules the following run", async () => {
  const timers = [];
  const calls = [];
  const nowValues = [new Date("2026-08-12T23:00:00Z"), new Date("2026-08-13T00:00:00Z"), new Date("2026-08-13T00:00:00Z")];
  const stop = startDailyReportSyncScheduler({
    now: () => nowValues.shift() || new Date("2026-08-13T00:00:00Z"),
    run: async (range) => { calls.push(range); return { pulled: 1, upserted: 1 }; },
    setTimer: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimer: () => {},
    logger: { info() {}, warn() {} },
  });
  assert.equal(timers[0].delay, 60 * 60 * 1_000);
  await timers[0].callback();
  assert.deepEqual(calls, [{ from: "2026-08-12", to: "2026-08-13" }]);
  assert.equal(timers.length, 2);
  stop();
});
