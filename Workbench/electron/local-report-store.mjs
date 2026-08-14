import { randomUUID } from "node:crypto";
import path from "node:path";
import { openLocalFirstDatabase } from "../server/db/local-first.mjs";
import { normalizeDailyReportInput } from "../shared/daily-report-contracts.mjs";

const LEGACY_ID = "local-self";

export function createLocalReportStore(userDataPath) {
  const db = openLocalFirstDatabase(path.join(userDataPath, "workbench.sqlite"));
  const stamp = () => new Date().toISOString();
  let identityId = null;
  const row = (value) => value && ({ id: value.id, reportDate: value.report_date, summary: value.summary || "", completedItems: JSON.parse(value.completed_snapshot_json || "[]")[0] || "", blockers: JSON.parse(value.completed_snapshot_json || "[]")[1] || "", nextActions: JSON.parse(value.next_actions_snapshot_json || "[]")[0] || "", syncStatus: value.sync_status === "failed" ? "error" : value.sync_status, remoteId: value.raw_payload_ref, lastSyncAt: value.synced_at, syncError: value.source_updated_at, createdAt: value.created_at, updatedAt: value.updated_at });
  const requireIdentity = () => { if (!identityId) throw new Error("请先登录钉钉账号。"); return identityId; };
  const get = (date) => row(db.prepare("SELECT * FROM daily_reports WHERE owner_identity_id=? AND report_date=?").get(requireIdentity(), String(date)));

  function setIdentity(profile) {
    if (!profile?.id) { identityId = null; return null; }
    const now = stamp();
    identityId = String(profile.id);
    db.prepare("INSERT INTO identities(id,provider,provider_account_id,display_name,avatar_url,profile_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(provider,provider_account_id) DO UPDATE SET display_name=excluded.display_name,avatar_url=excluded.avatar_url,profile_json=excluded.profile_json,updated_at=excluded.updated_at")
      .run(identityId, "dingtalk", identityId, profile.displayName || null, profile.avatarUrl || null, JSON.stringify(profile), now, now);
    // The pre-account local draft belongs only to the first successfully identified account.
    db.prepare("UPDATE daily_reports SET owner_identity_id=? WHERE owner_identity_id=?").run(identityId, LEGACY_ID);
    return identityId;
  }
  function list(from, to) { return db.prepare("SELECT * FROM daily_reports WHERE owner_identity_id=? AND report_date BETWEEN ? AND ? ORDER BY report_date").all(requireIdentity(), String(from), String(to)).map(row); }
  function save(input, syncStatus = "draft") { const report = normalizeDailyReportInput(input); const old = get(report.reportDate); const now = stamp(); const status = syncStatus === "error" ? "failed" : syncStatus; db.prepare(`INSERT INTO daily_reports(id,owner_identity_id,report_date,source,sync_status,summary,completed_snapshot_json,next_actions_snapshot_json,raw_payload_ref,synced_at,source_updated_at,created_at,updated_at) VALUES(@id,@owner,@date,'manual',@status,@summary,@completed,@next,@remote,@synced,@error,@created,@updated) ON CONFLICT(owner_identity_id,report_date) DO UPDATE SET sync_status=excluded.sync_status,summary=excluded.summary,completed_snapshot_json=excluded.completed_snapshot_json,next_actions_snapshot_json=excluded.next_actions_snapshot_json,source_updated_at=excluded.source_updated_at,updated_at=excluded.updated_at`).run({ id: old?.id || `local-${randomUUID()}`, owner: requireIdentity(), date: report.reportDate, status, summary: report.summary, completed: JSON.stringify([report.completedItems, report.blockers]), next: JSON.stringify([report.nextActions]), remote: old?.remoteId || null, synced: old?.lastSyncAt || null, error: null, created: old?.createdAt || now, updated: now }); return get(report.reportDate); }
  function markSynced(date, remoteId) { db.prepare("UPDATE daily_reports SET sync_status='synced',raw_payload_ref=?,synced_at=?,source_updated_at=NULL,updated_at=? WHERE owner_identity_id=? AND report_date=?").run(remoteId, stamp(), stamp(), requireIdentity(), String(date)); return get(date); }
  function markError(date, message) { db.prepare("UPDATE daily_reports SET sync_status='failed',source_updated_at=?,updated_at=? WHERE owner_identity_id=? AND report_date=?").run(String(message).slice(0, 1000), stamp(), requireIdentity(), String(date)); return get(date); }
  const listPending = () => db.prepare("SELECT * FROM daily_reports WHERE owner_identity_id=? AND sync_status IN ('pending_sync','failed') ORDER BY report_date").all(requireIdentity()).map(row);
  return { setIdentity, get, list, save, markSynced, markError, listPending, close: () => db.close() };
}
