// 团队日报摘要：规则聚合（无 LLM 时的回退）+ LLM/规则双模式调度。
// LLM 未配置或调用失败时自动降级为规则聚合，不阻断主管查看，也不使用演示数据。

import { createTeamSummaryService } from "../shared/team-daily-summary-ai.mjs";

// 判断协作/遗留事项是否可能需要领导介入的关键词（用于规则回退的优先级判定）
const DECISION_KEYWORDS = /审批|确认|决策|资源|支持|协调|排期|延期|缺口|缺人|拍板|方案|立项|权限/;

// 按换行/分号/句号拆分日报字段文本，过滤过短碎片
function splitLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .flatMap((line) => line.split(/[；;。]/))
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter((item) => item.length > 1);
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

// 从 report 提取部门名（departmentNames 可能以 "A · B" 形式存在）
function departmentsOf(item) {
  return (Array.isArray(item.departmentNames) ? item.departmentNames : [])
    .flatMap((name) => String(name || "").split(" · "))
    .map((name) => name.trim())
    .filter(Boolean);
}

// 规则聚合：把当日成员日报的阻塞/协作/明日计划按文本去重，并合并涉及成员与部门。
export function aggregateTeamSummary(reports = []) {
  const blockerMap = new Map();
  const decisionMap = new Map();
  const actionMap = new Map();

  for (const report of reports) {
    const name = normalizeText(report.displayName) || "成员";
    const departments = departmentsOf(report);
    for (const line of splitLines(report.blockers)) {
      const entry = blockerMap.get(line) || { text: line, affectedMembers: [], departments: new Set(), severity: "medium" };
      if (!entry.affectedMembers.includes(name)) entry.affectedMembers.push(name);
      for (const dept of departments) entry.departments.add(dept);
      blockerMap.set(line, entry);
    }
    for (const line of splitLines(report.cooperationNeeds)) {
      const entry = decisionMap.get(line) || {
        text: line,
        owner: null,
        dueAt: null,
        priority: DECISION_KEYWORDS.test(line) ? "P0" : "P1",
        reason: "来自成员日报的协作/待协调事项",
      };
      if (!entry.owner && departments[0]) entry.owner = `${name}（${departments[0]}）`;
      decisionMap.set(line, entry);
    }
    for (const line of splitLines(report.nextActions)) {
      const entry = actionMap.get(line) || { text: line, owner: null, departmentName: departments[0] || null };
      if (!entry.owner) entry.owner = name;
      if (!entry.departmentName && departments[0]) entry.departmentName = departments[0];
      actionMap.set(line, entry);
    }
  }

  const blockers = [...blockerMap.values()].map((item) => {
    const departments = [...item.departments];
    const severity = item.affectedMembers.length >= 3 || departments.length > 1 ? "high" : "medium";
    return { text: item.text, affectedMembers: item.affectedMembers, departments, severity };
  });

  const decisions = [...decisionMap.values()].map(({ text, owner, dueAt, priority, reason }) => ({ text, owner, dueAt, priority, reason }));

  const nextActions = [...actionMap.values()].map(({ text, owner, departmentName }) => ({ text, owner, departmentName }));

  return { blockers, decisions, nextActions };
}

// 调度：配置了 DeepSeek 时优先 LLM 结构化分析，否则或失败时降级为规则聚合。
export async function analyzeTeamSummary(reports = [], { config = {}, fetchImpl } = {}) {
  const rule = aggregateTeamSummary(reports);
  if (!config?.deepseekApiKey) return { mode: "rule", ...rule };
  try {
    const generate = createTeamSummaryService({ config, fetchImpl });
    const input = {
      reportDate: null,
      reports: reports.map((report) => ({
        displayName: report.displayName || "",
        departmentNames: report.departmentNames || [],
        blockers: report.blockers || "",
        cooperationNeeds: report.cooperationNeeds || "",
        nextActions: report.nextActions || "",
      })),
    };
    const llm = await generate(input);
    return { mode: "llm", ...llm };
  } catch {
    // LLM 不可用或分析失败时降级为规则聚合，不阻断主管查看。
    return { mode: "rule", ...rule };
  }
}
