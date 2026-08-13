import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const STATUSES = ["active", "completed"];

function focusError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function asDate(value, label) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw focusError("INVALID_FOCUS_WEEK", `${label} 必须是 YYYY-MM-DD。`);
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) throw focusError("INVALID_FOCUS_WEEK", `${label} 不是有效日期。`);
  return text;
}

function localDateString(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function weekEnd(weekStart) {
  const date = new Date(`${weekStart}T00:00:00`);
  date.setDate(date.getDate() + 6);
  return localDateString(date);
}

function currentWeekStart(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return localDateString(date);
}

function title(value) {
  const result = String(value ?? "").trim();
  if (!result || result.length > 200) throw focusError("INVALID_FOCUS_TITLE", "关注目标标题不能为空且不能超过 200 个字符。");
  return result;
}

function text(value, max, label) {
  const result = String(value ?? "").trim();
  if (result.length > max) throw focusError(`INVALID_FOCUS_${label.toUpperCase()}`, `${label}不能超过 ${max} 个字符。`);
  return result || null;
}

function progress(value) {
  const result = Number(value ?? 0);
  if (!Number.isInteger(result) || result < 0 || result > 100) throw focusError("INVALID_FOCUS_PROGRESS", "进度必须是 0 到 100 的整数。");
  return result;
}

function status(value) {
  if (!STATUSES.includes(value)) throw focusError("INVALID_FOCUS_STATUS", "不支持的关注目标状态。");
  return value;
}

export function createWeeklyFocusService({ dbPath, taskService, seedFocus = [] }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS weekly_focus (
      id TEXT PRIMARY KEY,
      week_start TEXT NOT NULL,
      week_end TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
      next_step TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_weekly_focus_week ON weekly_focus(week_start, created_at);
    CREATE TABLE IF NOT EXISTS weekly_focus_tasks (
      focus_id TEXT NOT NULL REFERENCES weekly_focus(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (focus_id, task_id)
    );
  `);
  db.pragma("foreign_keys = ON");

  const rowSelect = db.prepare(`SELECT id, week_start AS weekStart, week_end AS weekEnd,
    title, detail, progress, next_step AS nextStep, status,
    created_at AS createdAt, updated_at AS updatedAt FROM weekly_focus`);
  const weekRows = db.prepare(`${rowSelect.source} WHERE week_start = ? ORDER BY created_at ASC`);
  const getRow = db.prepare(`${rowSelect.source} WHERE id = ?`);

  function hydrate(row) {
    if (!row) return null;
    const taskIds = db.prepare("SELECT task_id AS taskId FROM weekly_focus_tasks WHERE focus_id = ? ORDER BY created_at").all(row.id).map((item) => item.taskId);
    const tasks = taskIds.map((id) => taskService.get(id)).filter(Boolean);
    const completedTaskCount = tasks.filter((task) => task.status === "completed").length;
    const taskProgress = tasks.length ? Math.round(completedTaskCount / tasks.length * 100) : null;
    return { ...row, taskIds, tasks, completedTaskCount, taskProgress, effectiveProgress: taskProgress ?? row.progress };
  }

  function seed(weekStart) {
    if (weekStart !== currentWeekStart() || !seedFocus.length) return;
    const count = db.prepare("SELECT COUNT(*) AS count FROM weekly_focus WHERE week_start = ?").get(weekStart).count;
    if (count) return;
    const insert = db.prepare(`INSERT INTO weekly_focus
      (id, week_start, week_end, title, detail, progress, next_step, status, created_at, updated_at)
      VALUES (@id, @weekStart, @weekEnd, @title, @detail, @progress, @nextStep, 'active', @now, @now)`);
    const now = new Date().toISOString();
    db.transaction(() => seedFocus.forEach((item) => insert.run({
      id: randomUUID(), weekStart, weekEnd: weekEnd(weekStart), title: title(item.title),
      detail: text(item.detail, 2000, "说明"), progress: 0, nextStep: null, now,
    })))();
  }

  function list(week) {
    const weekStart = asDate(week || currentWeekStart(), "周起始日期");
    seed(weekStart);
    return weekRows.all(weekStart).map(hydrate);
  }

  function create(input = {}) {
    const weekStart = asDate(input.weekStart || currentWeekStart(), "周起始日期");
    const now = new Date().toISOString();
    const item = { id: randomUUID(), weekStart, weekEnd: weekEnd(weekStart), title: title(input.title), detail: text(input.detail, 2000, "说明"), progress: progress(input.progress), nextStep: text(input.nextStep, 1000, "下一步"), status: status(input.status || "active"), createdAt: now, updatedAt: now };
    db.prepare(`INSERT INTO weekly_focus (id, week_start, week_end, title, detail, progress, next_step, status, created_at, updated_at)
      VALUES (@id, @weekStart, @weekEnd, @title, @detail, @progress, @nextStep, @status, @createdAt, @updatedAt)`).run(item);
    return hydrate(item);
  }

  function update(id, input = {}) {
    const existing = hydrate(getRow.get(String(id)));
    if (!existing) throw focusError("FOCUS_NOT_FOUND", "本周关注目标不存在。");
    const next = {
      ...existing,
      title: input.title === undefined ? existing.title : title(input.title),
      detail: input.detail === undefined ? existing.detail : text(input.detail, 2000, "说明"),
      progress: input.progress === undefined ? existing.progress : progress(input.progress),
      nextStep: input.nextStep === undefined ? existing.nextStep : text(input.nextStep, 1000, "下一步"),
      status: input.status === undefined ? existing.status : status(input.status),
      updatedAt: new Date().toISOString(),
    };
    db.prepare(`UPDATE weekly_focus SET title=@title, detail=@detail, progress=@progress,
      next_step=@nextStep, status=@status, updated_at=@updatedAt WHERE id=@id`).run(next);
    return hydrate(next);
  }

  function remove(id) {
    const result = db.prepare("DELETE FROM weekly_focus WHERE id = ?").run(String(id));
    if (!result.changes) throw focusError("FOCUS_NOT_FOUND", "本周关注目标不存在。");
    return { ok: true };
  }

  function attachTask(focusId, taskId) {
    const focus = getRow.get(String(focusId));
    if (!focus) throw focusError("FOCUS_NOT_FOUND", "本周关注目标不存在。");
    if (!taskService.get(taskId)) throw focusError("TASK_NOT_FOUND", "关联的任务不存在。");
    try {
      db.prepare("INSERT INTO weekly_focus_tasks (focus_id, task_id, created_at) VALUES (?, ?, ?)").run(String(focusId), String(taskId), new Date().toISOString());
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_PRIMARYKEY") throw focusError("FOCUS_TASK_DUPLICATE", "该任务已经关联到目标。");
      throw error;
    }
    return hydrate(focus);
  }

  function detachTask(focusId, taskId) {
    const result = db.prepare("DELETE FROM weekly_focus_tasks WHERE focus_id = ? AND task_id = ?").run(String(focusId), String(taskId));
    if (!result.changes) throw focusError("FOCUS_TASK_NOT_FOUND", "目标未关联该任务。");
    return hydrate(getRow.get(String(focusId)));
  }

  return { list, create, update, remove, attachTask, detachTask, close: () => db.close() };
}

export { currentWeekStart, weekEnd };
