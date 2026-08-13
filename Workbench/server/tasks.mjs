import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const PRIORITIES = ["P0", "P1", "P2"];
const STATUSES = ["open", "completed"];

function taskError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function asTask(row) {
  return row ? {
    ...row,
    completed: row.status === "completed",
  } : null;
}

function validateTitle(value) {
  const title = String(value ?? "").trim();
  if (!title || title.length > 200) {
    throw taskError("INVALID_TASK_TITLE", "任务标题不能为空且不能超过 200 个字符。");
  }
  return title;
}

function validatePriority(value) {
  const priority = value ?? "P1";
  if (!PRIORITIES.includes(priority)) throw taskError("INVALID_TASK_PRIORITY", "不支持的任务优先级。");
  return priority;
}

function validateDueAt(value) {
  if (value === null || value === undefined || value === "") return null;
  const dueAt = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/.test(dueAt)) {
    throw taskError("INVALID_TASK_DUE_AT", "截止时间格式无效。");
  }
  return dueAt;
}

function validateDetail(value) {
  const detail = String(value ?? "").trim();
  if (detail.length > 1000) throw taskError("INVALID_TASK_DETAIL", "任务备注不能超过 1000 个字符。");
  return detail || null;
}

function validateOptionalText(value, max, code, message) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (text.length > max) throw taskError(code, message);
  return text || null;
}

export function createTaskService({ dbPath, seedTasks = [] }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      detail TEXT,
      priority TEXT NOT NULL DEFAULT 'P1' CHECK (priority IN ('P0', 'P1', 'P2')),
      due_at TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status, due_at, created_at);
  `);
  const taskColumns = new Set(db.prepare("PRAGMA table_info(tasks)").all().map((column) => column.name));
  const migrations = [
    ["source_type", "ALTER TABLE tasks ADD COLUMN source_type TEXT"],
    ["source_id", "ALTER TABLE tasks ADD COLUMN source_id TEXT"],
    ["source_url", "ALTER TABLE tasks ADD COLUMN source_url TEXT"],
    ["priority_reason", "ALTER TABLE tasks ADD COLUMN priority_reason TEXT"],
  ];
  for (const [column, statement] of migrations) {
    if (!taskColumns.has(column)) db.exec(statement);
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL;");

  const count = db.prepare("SELECT COUNT(*) AS count FROM tasks").get().count;
  if (count === 0 && seedTasks.length) {
    const insert = db.prepare(`INSERT INTO tasks
      (id, title, detail, priority, due_at, status, created_at, updated_at, completed_at, source_type, source_id, source_url, priority_reason)
      VALUES (@id, @title, @detail, @priority, @dueAt, @status, @createdAt, @updatedAt, @completedAt, @sourceType, @sourceId, @sourceUrl, @priorityReason)`);
    const now = new Date().toISOString();
    const seed = db.transaction(() => {
      for (const source of seedTasks) {
        insert.run({
          id: String(source.id || randomUUID()),
          title: validateTitle(source.title),
          detail: validateDetail(source.detail ?? source.meta),
          priority: validatePriority(source.priority),
          dueAt: validateDueAt(source.dueAt),
          status: source.completed ? "completed" : "open",
          createdAt: now,
          updatedAt: now,
          completedAt: source.completed ? now : null,
          sourceType: validateOptionalText(source.sourceType, 80, "INVALID_TASK_SOURCE", "任务来源类型无效。"),
          sourceId: validateOptionalText(source.sourceId, 512, "INVALID_TASK_SOURCE", "任务来源标识无效。"),
          sourceUrl: validateOptionalText(source.sourceUrl, 2_048, "INVALID_TASK_SOURCE", "任务来源链接无效。"),
          priorityReason: validateOptionalText(source.priorityReason, 500, "INVALID_TASK_PRIORITY_REASON", "优先级原因过长。"),
        });
      }
    });
    seed();
  }

  const select = db.prepare(`SELECT id, title, detail, priority, due_at AS dueAt,
    status, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt,
    source_type AS sourceType, source_id AS sourceId, source_url AS sourceUrl, priority_reason AS priorityReason
    FROM tasks`);

  function list(status = "all") {
    if (status !== "all" && !STATUSES.includes(status)) throw taskError("INVALID_TASK_STATUS", "不支持的任务状态。");
    const where = status === "all" ? "" : "WHERE status = @status";
    return db.prepare(`${select.source} ${where}
      ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,
      CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END,
      CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, created_at DESC`)
      .all(status === "all" ? {} : { status }).map(asTask);
  }

  function get(id) {
    return asTask(db.prepare(`${select.source} WHERE id = ?`).get(String(id)));
  }

  function create(input = {}) {
    const sourceType = validateOptionalText(input.sourceType, 80, "INVALID_TASK_SOURCE", "任务来源类型无效。");
    const sourceId = validateOptionalText(input.sourceId, 512, "INVALID_TASK_SOURCE", "任务来源标识无效。");
    if (sourceType && sourceId) {
      const existing = asTask(db.prepare(`${select.source} WHERE source_type = ? AND source_id = ?`).get(sourceType, sourceId));
      if (existing) return existing;
    }
    const now = new Date().toISOString();
    const task = {
      id: randomUUID(),
      title: validateTitle(input.title),
      detail: validateDetail(input.detail),
      priority: validatePriority(input.priority),
      dueAt: validateDueAt(input.dueAt),
      status: "open",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      sourceType,
      sourceId,
      sourceUrl: validateOptionalText(input.sourceUrl, 2_048, "INVALID_TASK_SOURCE", "任务来源链接无效。"),
      priorityReason: validateOptionalText(input.priorityReason, 500, "INVALID_TASK_PRIORITY_REASON", "优先级原因过长。"),
    };
    db.prepare(`INSERT INTO tasks
      (id, title, detail, priority, due_at, status, created_at, updated_at, completed_at, source_type, source_id, source_url, priority_reason)
      VALUES (@id, @title, @detail, @priority, @dueAt, @status, @createdAt, @updatedAt, @completedAt, @sourceType, @sourceId, @sourceUrl, @priorityReason)`).run(task);
    return asTask(task);
  }

  function update(id, input = {}) {
    const existing = get(id);
    if (!existing) throw taskError("TASK_NOT_FOUND", "任务不存在。");
    const nextStatus = input.status === undefined ? existing.status : input.status;
    if (!STATUSES.includes(nextStatus)) throw taskError("INVALID_TASK_STATUS", "不支持的任务状态。");
    const now = new Date().toISOString();
    const next = {
      id: existing.id,
      title: input.title === undefined ? existing.title : validateTitle(input.title),
      detail: input.detail === undefined ? existing.detail : validateDetail(input.detail),
      priority: input.priority === undefined ? existing.priority : validatePriority(input.priority),
      dueAt: input.dueAt === undefined ? existing.dueAt : validateDueAt(input.dueAt),
      status: nextStatus,
      updatedAt: now,
      completedAt: nextStatus === "completed" ? (existing.completedAt || now) : null,
      sourceType: existing.sourceType,
      sourceId: existing.sourceId,
      sourceUrl: input.sourceUrl === undefined ? existing.sourceUrl : validateOptionalText(input.sourceUrl, 2_048, "INVALID_TASK_SOURCE", "任务来源链接无效。"),
      priorityReason: input.priorityReason === undefined ? existing.priorityReason : validateOptionalText(input.priorityReason, 500, "INVALID_TASK_PRIORITY_REASON", "优先级原因过长。"),
    };
    db.prepare(`UPDATE tasks SET title=@title, detail=@detail, priority=@priority, due_at=@dueAt,
      status=@status, updated_at=@updatedAt, completed_at=@completedAt,
      source_url=@sourceUrl, priority_reason=@priorityReason WHERE id=@id`).run(next);
    return get(id);
  }

  function remove(id) {
    const result = db.prepare("DELETE FROM tasks WHERE id = ?").run(String(id));
    if (!result.changes) throw taskError("TASK_NOT_FOUND", "任务不存在。");
    return { ok: true };
  }

  function clearCompleted() {
    return { removed: db.prepare("DELETE FROM tasks WHERE status = 'completed'").run().changes };
  }

  return { list, get, create, update, remove, clearCompleted, close: () => db.close() };
}
