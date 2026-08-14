import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const migrations = ["001_local_first_core", "002_identity_ownership", "003_org_multi_department"];
const migrationsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export function openLocalFirstDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const firstOpen = !fs.existsSync(dbPath);
  if (!firstOpen) fs.copyFileSync(dbPath, `${dbPath}.pre-local-first-${Date.now()}.bak`);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  for (const migrationVersion of migrations) if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version=?").get(migrationVersion)) {
    const sql = fs.readFileSync(path.join(migrationsDirectory, `${migrationVersion}.sql`), "utf8");
    db.transaction(() => {
      db.exec(sql);
      if (migrationVersion === "001_local_first_core") migrateLegacy(db);
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?,?)").run(migrationVersion, new Date().toISOString());
    })();
  }
  return db;
}

function hasTable(db, name) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)); }
function migrateLegacy(db) {
  if (hasTable(db, "tasks")) { const c=new Set(db.prepare("PRAGMA table_info(tasks)").all().map(x=>x.name)); const col=n=>c.has(n)?n:"NULL"; db.exec(`INSERT OR IGNORE INTO work_items (id,kind,title,description,status,priority,due_at,completed_at,source_type,source_external_id,source_url,source_snapshot_json,created_at,updated_at)
    SELECT id,'task',title,detail,CASE status WHEN 'completed' THEN 'done' ELSE 'planned' END,priority,due_at,completed_at,${col("source_type")},${col("source_id")},${col("source_url")},json_object('priorityReason',${col("priority_reason")}),created_at,updated_at FROM tasks`); }
  if (hasTable(db, "weekly_focus")) db.exec(`INSERT OR IGNORE INTO goals (id,period_type,period_start,period_end,title,detail,manual_progress,next_step,status,created_at,updated_at)
    SELECT id,'week',week_start,week_end,title,detail,progress,next_step,CASE status WHEN 'completed' THEN 'completed' ELSE 'active' END,created_at,updated_at FROM weekly_focus`);
  if (hasTable(db, "weekly_focus_tasks")) db.exec("INSERT OR IGNORE INTO goal_work_items(goal_id,work_item_id,created_at) SELECT focus_id,task_id,created_at FROM weekly_focus_tasks WHERE EXISTS(SELECT 1 FROM goals WHERE id=focus_id) AND EXISTS(SELECT 1 FROM work_items WHERE id=task_id)");
  if (hasTable(db, "daily_report_drafts")) db.exec(`INSERT OR IGNORE INTO daily_reports (id,report_date,source,sync_status,summary,completed_snapshot_json,next_actions_snapshot_json,raw_payload_ref,submitted_at,synced_at,created_at,updated_at)
    SELECT id,report_date,'manual',CASE sync_status WHEN 'error' THEN 'failed' ELSE sync_status END,summary,json_array(completed_items,blockers),json_array(next_actions),remote_id,NULL,last_sync_at,created_at,updated_at FROM daily_report_drafts`);
}
