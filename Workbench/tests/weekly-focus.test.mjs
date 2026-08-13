import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWeeklyFocusService } from "../server/weekly-focus.mjs";

function taskService() {
  const tasks = new Map([
    ["task-1", { id: "task-1", title: "完成路线确认", status: "open" }],
    ["task-2", { id: "task-2", title: "发送会议纪要", status: "completed" }],
  ]);
  return { get: (id) => tasks.get(String(id)) || null };
}

async function createService(seedFocus = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "weekly-focus-"));
  const service = createWeeklyFocusService({ dbPath: path.join(root, "focus.sqlite"), taskService: taskService(), seedFocus });
  return { root, service };
}

test("weekly focus persists goals by week and hydrates linked tasks", async () => {
  const { root, service } = await createService();
  const goal = service.create({ weekStart: "2026-08-10", title: "守住交付节奏", detail: "完成关键决策", progress: 40, nextStep: "确认排期" });
  service.attachTask(goal.id, "task-1");
  service.attachTask(goal.id, "task-2");

  const listed = service.list("2026-08-10");
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0].tasks.map((task) => task.id), ["task-1", "task-2"]);
  assert.equal(listed[0].completedTaskCount, 1);
  assert.equal(listed[0].taskProgress, 50);
  assert.equal(listed[0].effectiveProgress, 50);
  assert.deepEqual(service.list("2026-08-17"), []);
  service.close();

  const reopened = createWeeklyFocusService({ dbPath: path.join(root, "focus.sqlite"), taskService: taskService() });
  assert.equal(reopened.list("2026-08-10")[0].title, "守住交付节奏");
  reopened.close();
});

test("weekly focus validates fields and prevents duplicate or unknown task links", async () => {
  const { service } = await createService();
  assert.throws(() => service.create({ weekStart: "2026-08-10", title: "", progress: 0 }), /标题不能为空/);
  assert.throws(() => service.create({ weekStart: "2026-08-10", title: "目标", progress: 101 }), /0 到 100/);
  assert.throws(() => service.create({ weekStart: "2026-08-10", title: "目标", status: "paused" }), /状态/);
  const goal = service.create({ weekStart: "2026-08-10", title: "目标" });
  assert.throws(() => service.attachTask(goal.id, "missing"), /任务不存在/);
  service.attachTask(goal.id, "task-1");
  assert.throws(() => service.attachTask(goal.id, "task-1"), /已经关联/);
  service.close();
});
