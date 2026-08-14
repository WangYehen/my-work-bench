import assert from "node:assert/strict";
import test from "node:test";
import { groupActions, mailAsAction, taskAsAction } from "../src/lib/work-loop.js";
import { parseDailyDraftResponse, ruleDailyDraft } from "../shared/daily-report-ai.mjs";

test("action groups sort overdue, today, high priority, then later", () => {
  const now = new Date("2026-08-13T10:00:00+08:00");
  const groups = groupActions([
    { id: "later", priority: "P2", receivedAt: "2026-08-13T09:00:00+08:00" },
    { id: "high", priority: "P0", dueAt: "2026-08-14T12:00:00+08:00" },
    { id: "today", priority: "P1", dueAt: "2026-08-13T18:00:00+08:00" },
    { id: "late", priority: "P1", dueAt: "2026-08-12T18:00:00+08:00" },
  ], now);
  assert.deepEqual(groups.map((group) => group.id), ["overdue", "today", "high", "later"]);
});

test("mail actions preserve priority reason and provenance", () => {
  const action = mailAsAction({ id: "m1", subject: "确认合同", actionText: "回复确认", priority: "P0", priorityReason: "今天截止", webLink: "https://example.test" });
  assert.equal(action.sourceType, "outlook");
  assert.equal(action.actionKind, "outlook-message");
  assert.equal(action.priorityReason, "今天截止");
});

test("converted Outlook tasks remain completable task actions", () => {
  const action = taskAsAction({ id: "task-1", title: "回复邮件", sourceType: "outlook", sourceId: "mail-1" });
  assert.equal(action.actionKind, "task");
  assert.equal(action.source, "Outlook");
});

test("daily draft rules and parser keep the four-field contract", () => {
  const fallback = ruleDailyDraft({ tasks: [{ title: "完成接口联调" }], meetings: [{ title: "需求评审" }], emails: [] });
  assert.match(fallback.completedItems, /完成接口联调/);
  const parsed = parseDailyDraftResponse('{"summary":"完成联调","completedItems":"- 联调","blockers":"无","nextActions":"上线"}');
  assert.equal(parsed.source, "ai");
  assert.equal(parsed.nextActions, "上线");
});
