import assert from "node:assert/strict";
import test from "node:test";
import { aggregateTeamSummary, analyzeTeamSummary } from "../server/team-summary.mjs";
import { normalizeTeamSummary, parseTeamSummaryResponse } from "../shared/team-daily-summary-ai.mjs";

// 构造三条成员日报：两条共享同一阻塞、一条协作需决策，用于验证规则聚合
const reports = [
  { displayName: "Charles", departmentNames: ["Backend Development Group"], blockers: "测试环境接口不稳定；第三方审批未完成", cooperationNeeds: "需要确认数据权限方案", nextActions: "完成接口修复" },
  { displayName: "Alice", departmentNames: ["Frontend Development Group"], blockers: "测试环境接口不稳定", cooperationNeeds: "需要确认数据权限方案", nextActions: "完成前端页面" },
  { displayName: "Deep", departmentNames: ["Backend Development Group"], blockers: "", cooperationNeeds: "", nextActions: "完成接口修复" },
];

test("规则聚合：阻塞跨成员去重并合并涉及成员与部门、按人数与部门判定严重度", async (t) => {
  const { blockers } = aggregateTeamSummary(reports);
  assert.equal(blockers.length, 2);
  const shared = blockers.find((item) => item.text === "测试环境接口不稳定");
  assert.deepEqual(shared.affectedMembers, ["Charles", "Alice"]);
  assert.deepEqual(shared.departments, ["Backend Development Group", "Frontend Development Group"]);
  assert.equal(shared.severity, "high");
  const single = blockers.find((item) => item.text === "第三方审批未完成");
  assert.deepEqual(single.affectedMembers, ["Charles"]);
  assert.equal(single.severity, "medium");
});

test("规则聚合：协作需求进入待决策候选，含关键词时置为 P0 并标注提出人", async (t) => {
  const { decisions } = aggregateTeamSummary(reports);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].text, "需要确认数据权限方案");
  assert.equal(decisions[0].priority, "P0");
  assert.equal(decisions[0].owner, "Charles（Backend Development Group）");
});

test("规则聚合：明日行动按文本去重并补充负责人与部门", async (t) => {
  const { nextActions } = aggregateTeamSummary(reports);
  assert.equal(nextActions.length, 2);
  const fix = nextActions.find((item) => item.text === "完成接口修复");
  assert.equal(fix.owner, "Charles");
  assert.equal(fix.departmentName, "Backend Development Group");
  const page = nextActions.find((item) => item.text === "完成前端页面");
  assert.equal(page.owner, "Alice");
});

test("未配置 DEEPSEEK_API_KEY 时降级为规则聚合且标记 mode=rule", async () => {
  const summary = await analyzeTeamSummary(reports, { config: {} });
  assert.equal(summary.mode, "rule");
  assert.ok(summary.blockers.length > 0);
});

test("配置 API Key 且 LLM 成功时返回 mode=llm 并归一化结果", async () => {
  const llmPayload = {
    blockers: [{ text: "测试环境接口不稳定", affectedMembers: ["Charles", "Alice"], departments: ["Backend"], severity: "high" }],
    decisions: [{ text: "是否追加测试资源", owner: null, dueAt: null, priority: "P0", reason: "阻塞联调" }],
    nextActions: [{ text: "完成接口修复", owner: "Charles", departmentName: "Backend" }],
  };
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(llmPayload) } }] }), { status: 200 });
  const summary = await analyzeTeamSummary(reports, { config: { deepseekApiKey: "mock" }, fetchImpl });
  assert.equal(summary.mode, "llm");
  assert.equal(summary.blockers[0].severity, "high");
  assert.equal(summary.decisions[0].priority, "P0");
});

test("LLM 调用失败时降级为规则聚合且不抛错", async () => {
  const fetchImpl = async () => new Response("boom", { status: 500 });
  const summary = await analyzeTeamSummary(reports, { config: { deepseekApiKey: "mock" }, fetchImpl });
  assert.equal(summary.mode, "rule");
  assert.ok(summary.blockers.length > 0);
});

test("解析 LLM 输出：剥离 markdown 代码块并归一化", () => {
  const normalized = parseTeamSummaryResponse("```json\n" + JSON.stringify({
    blockers: [{ text: "A", affectedMembers: ["X"], departments: [], severity: "unknown" }],
    decisions: [{ text: "B", priority: "P9" }],
    nextActions: [{ text: "C" }],
  }) + "\n```");
  assert.deepEqual(normalized, {
    blockers: [{ text: "A", affectedMembers: ["X"], departments: [], severity: "medium" }],
    decisions: [{ text: "B", owner: null, dueAt: null, priority: "P1", reason: null }],
    nextActions: [{ text: "C", owner: null, departmentName: null }],
  });
});

test("解析非法 LLM 输出时抛 TEAM_SUMMARY_INVALID", () => {
  assert.throws(() => parseTeamSummaryResponse("不是 JSON"), { code: "TEAM_SUMMARY_INVALID" });
});

test("normalizeTeamSummary 拒绝非对象并返回空契约", () => {
  assert.deepEqual(normalizeTeamSummary(null), { blockers: [], decisions: [], nextActions: [] });
});
