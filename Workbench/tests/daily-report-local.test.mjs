import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalReportStore } from "../electron/local-report-store.mjs";
import { normalizeDailyReportInput } from "../shared/daily-report-contracts.mjs";

test("local daily report store saves drafts and preserves sync errors locally", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workbench-daily-report-"));
  const store = createLocalReportStore(directory);
  try {
    const saved = store.save({ reportDate: "2026-08-12", summary: "完成任务", completedItems: "任务 A", blockers: "无", nextActions: "任务 B" }, "pending_sync");
    assert.equal(saved.syncStatus, "pending_sync");
    assert.equal(store.listPending().length, 1);
    assert.equal(store.markError("2026-08-12", "网络不可用").syncStatus, "error");
    assert.equal(store.get("2026-08-12").summary, "完成任务");
    assert.equal(store.markSynced("2026-08-12", "remote-1").remoteId, "remote-1");
    assert.equal(store.get("2026-08-12").syncStatus, "synced");
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("daily report contract rejects invalid or oversized payloads", () => {
  assert.throws(() => normalizeDailyReportInput({ reportDate: "12-08-2026", summary: "x" }), { code: "INVALID_REPORT_DATE" });
  assert.throws(() => normalizeDailyReportInput({ reportDate: "2026-08-12", summary: "" }), { code: "REPORT_SUMMARY_REQUIRED" });
  assert.throws(() => normalizeDailyReportInput({ reportDate: "2026-08-12", summary: "x".repeat(10_001) }), { code: "REPORT_FIELD_TOO_LONG" });
});
