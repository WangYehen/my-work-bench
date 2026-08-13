import assert from "node:assert/strict";
import test from "node:test";

import {
  createWeeklySummaryService,
  normalizeWeeklySummary,
  parseWeeklySummaryResponse,
} from "../shared/weekly-report-ai.mjs";

test("weekly summary parser accepts structured JSON and fenced JSON", () => {
  const value = parseWeeklySummaryResponse("```json\n{\"summary\":\"完成版本评审\",\"highlights\":[\"评审完成\"],\"blockers\":[],\"nextActions\":[\"跟进排期\"]}\n```");
  assert.deepEqual(value, {
    summary: "完成版本评审",
    highlights: ["评审完成"],
    blockers: [],
    nextActions: ["跟进排期"],
  });
});

test("weekly summary parser rejects missing or invalid fields", () => {
  assert.throws(() => normalizeWeeklySummary({ highlights: [] }), /缺少 summary/);
  assert.throws(() => parseWeeklySummaryResponse("not-json"), /有效的周报 JSON/);
});

test("weekly summary service keeps the API key server-side and parses the model response", async () => {
  let request;
  const generate = createWeeklySummaryService({
    config: { deepseekApiKey: "x", deepseekBaseUrl: "https://example.test", deepseekModel: "deepseek-chat" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "本周完成交付", highlights: [], blockers: [], nextActions: [] }) } }] }), { status: 200 });
    },
  });
  const result = await generate({ period: "2026-08-10 至 2026-08-14", tasks: [], outlookItems: [], dailyReports: [] });
  assert.equal(result.summary, "本周完成交付");
  assert.equal(request.url, "https://example.test/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer x");
  assert.match(request.options.body, /成员日报/);
});

test("weekly summary service reports missing configuration and HTTP failures", async () => {
  await assert.rejects(createWeeklySummaryService({})({}), /尚未配置 DEEPSEEK_API_KEY/);
  const generate = createWeeklySummaryService({
    config: { deepseekApiKey: "x" },
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  await assert.rejects(generate({}), /DeepSeek 请求失败/);
});
