import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTaskService } from "../server/tasks.mjs";

async function fixture(seedTasks = []) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workbench-tasks-"));
  const service = createTaskService({ dbPath: path.join(directory, "tasks.sqlite"), seedTasks });
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
