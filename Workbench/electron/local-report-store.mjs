import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { normalizeDailyReportInput } from "../shared/daily-report-contracts.mjs";

export function createLocalReportStore(userDataPath) {
  fs.mkdirSync(userDataPath, { recursive: true });
  const db = new Database(path.join(userDataPath, "workbench.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS daily_report_drafts (
    id TEXT PRIMARY KEY,
    report_date TEXT NOT NULL UNIQUE,
    summary TEXT NOT NULL DEFAULT '',
    completed_items TEXT NOT NULL DEFAULT '',
    blockers TEXT NOT NULL DEFAULT '',
    next_actions TEXT NOT NULL DEFAULT '',
    sync_status TEXT NOT NULL DEFAULT 'draft',
    remote_id TEXT,
    last_sync_at TEXT,
    sync_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`);

  const row = (record) => record ? ({
    id: record.id,
    reportDate: record.report_date,
    summary: record.summary,
    completedItems: record.completed_items,
    blockers: record.blockers,
    nextActions: record.next_actions,
    syncStatus: record.sync_status,
    remoteId: record.remote_id,
    lastSyncAt: record.last_sync_at,
    syncError: record.sync_error,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }) : null;

  function get(reportDate) {
    return row(db.prepare("SELECT * FROM daily_report_drafts WHERE report_date = ?").get(reportDate));
  }

  function list(from, to) {
    return db.prepare("SELECT * FROM daily_report_drafts WHERE report_date BETWEEN ? AND ? ORDER BY report_date ASC").all(String(from), String(to)).map(row);
  }

  function save(input, syncStatus = "draft") {
    const report = normalizeDailyReportInput(input);
    const existing = get(report.reportDate);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO daily_report_drafts
      (id, report_date, summary, completed_items, blockers, next_actions, sync_status, remote_id, last_sync_at, sync_error, created_at, updated_at)
      VALUES (@id, @reportDate, @summary, @completedItems, @blockers, @nextActions, @syncStatus, @remoteId, @lastSyncAt, @syncError, @createdAt, @updatedAt)
      ON CONFLICT(report_date) DO UPDATE SET summary=@summary, completed_items=@completedItems,
      blockers=@blockers, next_actions=@nextActions, sync_status=@syncStatus, updated_at=@updatedAt`).run({
      id: existing?.id || `local-${randomUUID()}`,
      ...report,
      syncStatus,
      remoteId: existing?.remoteId || null,
      lastSyncAt: existing?.lastSyncAt || null,
      syncError: null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });
    return get(report.reportDate);
  }

  function markSynced(reportDate, remoteId) {
    const now = new Date().toISOString();
    db.prepare("UPDATE daily_report_drafts SET sync_status='synced', remote_id=?, last_sync_at=?, sync_error=NULL, updated_at=? WHERE report_date=?").run(remoteId, now, now, reportDate);
    return get(reportDate);
  }

  function markError(reportDate, message) {
    db.prepare("UPDATE daily_report_drafts SET sync_status='error', sync_error=?, updated_at=? WHERE report_date=?").run(String(message).slice(0, 1000), new Date().toISOString(), reportDate);
    return get(reportDate);
  }

  function listPending() {
    return db.prepare("SELECT * FROM daily_report_drafts WHERE sync_status IN ('pending_sync', 'error') ORDER BY report_date ASC").all().map(row);
  }

  return { get, list, save, markSynced, markError, listPending, close: () => db.close() };
}
