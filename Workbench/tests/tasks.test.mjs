import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { createTaskService } from "../server/tasks.mjs";

async function fixture(seedTasks = [], options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workbench-tasks-"));
  const service = createTaskService({ dbPath: path.join(directory, "tasks.sqlite"), seedTasks, ...options });
  return { directory, service };
}

test("tasks seed on first boot and persist across service restarts", async () => {
  const { directory, service } = await fixture([{ id: "seed-1", title: "Seed task", priority: "P0" }]);
  const created = service.create({ title: "Persist me", detail: "Note", dueAt: "2026-08-12T15:00" });
  assert.equal(service.list().length, 2);
  service.close();
  const reopened = createTaskService({ dbPath: path.join(directory, "tasks.sqlite"), seedTasks: [{ id: "other", title: "Should not seed twice" }] });
  assert.equal(reopened.get(created.id).detail, "Note");
  assert.equal(reopened.list().filter((task) => task.id === "other").length, 0);
  reopened.close();
  await rm(directory, { recursive: true, force: true });
});

test("tasks support update, restore, delete, and clearing completed records", async () => {
  const { directory, service } = await fixture();
  const task = service.create({ title: "Do work" });
  assert.equal(service.update(task.id, { priority: "P0", status: "completed" }).completed, true);
  assert.equal(service.update(task.id, { status: "open" }).status, "open");
  service.update(task.id, { status: "completed" });
  assert.equal(service.clearCompleted().removed, 1);
  assert.equal(service.get(task.id), null);
  const second = service.create({ title: "Delete me" });
  assert.deepEqual(service.remove(second.id), { ok: true });
  assert.throws(() => service.remove(second.id), { code: "TASK_NOT_FOUND" });
  service.close();
  await rm(directory, { recursive: true, force: true });
});

test("tasks reject invalid title, priority, due date, and status", async () => {
  const { directory, service } = await fixture();
  assert.throws(() => service.create({ title: "" }), { code: "INVALID_TASK_TITLE" });
  assert.throws(() => service.create({ title: "Valid", priority: "P9" }), { code: "INVALID_TASK_PRIORITY" });
  assert.throws(() => service.create({ title: "Valid", dueAt: "tomorrow" }), { code: "INVALID_TASK_DUE_AT" });
  const task = service.create({ title: "Valid" });
  assert.throws(() => service.update(task.id, { status: "archived" }), { code: "INVALID_TASK_STATUS" });
  service.close();
  await rm(directory, { recursive: true, force: true });
});

test("tasks preserve source provenance and create idempotently by source", async () => {
  const { directory, service } = await fixture();
  const first = service.create({ title: "回复邮件", sourceType: "outlook", sourceId: "mail-1", sourceUrl: "https://example.test/mail/1", priorityReason: "今天截止" });
  const second = service.create({ title: "不应重复", sourceType: "outlook", sourceId: "mail-1" });
  assert.equal(second.id, first.id);
  assert.equal(service.list().length, 1);
  assert.equal(service.get(first.id).sourceUrl, "https://example.test/mail/1");
  service.close();
  await rm(directory, { recursive: true, force: true });
});

test("task completion snapshots persist, use Shanghai dates, and are removed when reopened", async () => {
  let current = new Date("2026-08-12T16:30:00.000Z");
  const { directory, service } = await fixture([], { now: () => current });
  const task = service.create({ title: "回复客户邮件", detail: "保留完成快照", sourceType: "outlook", sourceId: "mail-1" });
  service.update(task.id, { status: "completed" });
  assert.deepEqual(service.listCompletions("2026-08-13").map(({ title, sourceType, completionDate }) => ({ title, sourceType, completionDate })), [
    { title: "回复客户邮件", sourceType: "outlook", completionDate: "2026-08-13" },
  ]);
  service.update(task.id, { status: "open" });
  assert.equal(service.listCompletions("2026-08-13").length, 0);
  current = new Date("2026-08-13T17:00:00.000Z");
  service.update(task.id, { status: "completed" });
  assert.equal(service.listCompletions("2026-08-14")[0].completedAt, current.toISOString());
  service.close();
  const reopened = createTaskService({ dbPath: path.join(directory, "tasks.sqlite") });
  assert.equal(reopened.listCompletions("2026-08-14")[0].title, "回复客户邮件");
  reopened.close();
  await rm(directory, { recursive: true, force: true });
});

test("clearing or deleting completed tasks preserves their completion snapshots", async () => {
  const timestamp = new Date("2026-08-13T02:00:00.000Z");
  const { directory, service } = await fixture([], { now: () => timestamp });
  const first = service.create({ title: "清理后保留" });
  service.update(first.id, { status: "completed" });
  assert.equal(service.clearCompleted().removed, 1);
  const second = service.create({ title: "删除后保留" });
  service.update(second.id, { status: "completed" });
  service.remove(second.id);
  assert.deepEqual(service.listCompletions("2026-08-13").map((item) => item.title).sort(), ["删除后保留", "清理后保留"].sort());
  service.close();
  await rm(directory, { recursive: true, force: true });
});

test("existing completed tasks are backfilled once during migration", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workbench-tasks-migration-"));
  const dbPath = path.join(directory, "tasks.sqlite");
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE tasks (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, detail TEXT, priority TEXT NOT NULL,
    due_at TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
  )`);
  db.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("legacy-1", "历史完成任务", null, "P1", null, "completed", "2026-08-13T00:00:00.000Z", "2026-08-13T00:00:00.000Z", "2026-08-13T00:00:00.000Z");
  db.close();
  const service = createTaskService({ dbPath });
  assert.equal(service.listCompletions("2026-08-13").length, 1);
  service.close();
  const reopened = createTaskService({ dbPath });
  assert.equal(reopened.listCompletions("2026-08-13").length, 1);
  assert.throws(() => reopened.listCompletions("08/13/2026"), { code: "INVALID_TASK_COMPLETION_DATE" });
  reopened.close();
  await rm(directory, { recursive: true, force: true });
});
