const priorityRank = { P0: 0, P1: 1, P2: 2 };

export function localDateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).format(value);
}

export function actionBucket(item, now = new Date()) {
  const today = localDateKey(now);
  const dueKey = item.dueAt ? String(item.dueAt).slice(0, 10) : null;
  if (dueKey && dueKey < today) return "overdue";
  if (dueKey === today) return "today";
  if ((item.priority || "P1") === "P0") return "high";
  return "later";
}

export function compareActions(left, right, now = new Date()) {
  const bucketRank = { overdue: 0, today: 1, high: 2, later: 3 };
  const bucketDiff = bucketRank[actionBucket(left, now)] - bucketRank[actionBucket(right, now)];
  if (bucketDiff) return bucketDiff;
  const leftDue = left.dueAt || "9999-12-31";
  const rightDue = right.dueAt || "9999-12-31";
  const dueDiff = String(leftDue).localeCompare(String(rightDue));
  if (dueDiff) return dueDiff;
  const priorityDiff = (priorityRank[left.priority] ?? 1) - (priorityRank[right.priority] ?? 1);
  if (priorityDiff) return priorityDiff;
  return String(right.receivedAt || right.createdAt || "").localeCompare(String(left.receivedAt || left.createdAt || ""));
}

export function groupActions(items = [], now = new Date()) {
  const groups = [
    { id: "overdue", label: "已逾期", tone: "danger", items: [] },
    { id: "today", label: "今天截止", tone: "warning", items: [] },
    { id: "high", label: "高优先级", tone: "priority", items: [] },
    { id: "later", label: "稍后", tone: "muted", items: [] },
  ];
  const byId = new Map(groups.map((group) => [group.id, group]));
  [...items].sort((a, b) => compareActions(a, b, now)).forEach((item) => byId.get(actionBucket(item, now)).items.push(item));
  return groups.filter((group) => group.items.length);
}

export function mailAsAction(message) {
  return {
    id: `outlook:${message.id}`,
    sourceId: message.id,
    source: "Outlook",
    sourceType: "outlook",
    title: message.actionText || message.subject,
    detail: message.subject,
    dueAt: message.dueAt,
    priority: message.priority || "P1",
    priorityReason: message.priorityReason || "来自邮件行动判断",
    receivedAt: message.receivedAt,
    url: message.webLink,
  };
}

export function taskAsAction(task) {
  return {
    ...task,
    source: task.sourceType === "outlook" ? "Outlook" : task.sourceType === "dingtalk" ? "钉钉" : "手动",
    priorityReason: task.priorityReason || task.detail || (task.priority === "P0" ? "高优先级任务" : "按计划推进"),
  };
}
