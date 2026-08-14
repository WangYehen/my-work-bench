import assert from "node:assert/strict";
import test from "node:test";
import { createDingTalkReportService, dateRangeToMillis, dingtalkReportDate, normalizeDingTalkReport } from "../team-server/dingtalk-reports.mjs";

// 构造简易 Response 对象
function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

// 使用真实接口样例中的一封日志
const sampleRaw = {
  images: [],
  template_name: "IT部门日报",
  modified_time: 1786614638000,
  create_time: 1786614638000,
  contents: [
    { sort: "1", type: "1", value: "1. TMS-优化需求V8B-TCO-创建接口前端对接\r\n2. TMS-优化需求V8B-TCO-菜单脚本整理", key: "今日完成工作" },
    { sort: "2", type: "1", value: "", key: "今日遗留工作" },
    { sort: "3", type: "1", value: "1. IMS-优化需求202607-短装策略-更新在库库存\r\n2. IMS-优化需求202607-短装策略-记录流水", key: "明日工作计划" },
    { sort: "4", type: "1", value: "需要确认数据权限方案", key: "需要协作工作" },
    { sort: "5", type: "8", value: "[]", key: "图片" },
    { sort: "6", type: "9", value: "[{\"spaceId\":\"29291864425\",\"fileName\":\"测试跟踪表.axls\",\"fileSize\":0,\"fileType\":\"axls\",\"fileId\":\"232176660179\"}]", key: "附件" },
  ],
  report_id: "19ffa87e667d4ace23538d043e4ac023",
  creator_id: "16880263281934490",
  dept_name: "Backend Development Group",
  creator_name: "Zack（曾子豪）",
  remark: "",
};

test("normalizeDingTalkReport maps Chinese content keys and keeps the raw snapshot", () => {
  const report = normalizeDingTalkReport(sampleRaw);
  assert.equal(report.reportId, "19ffa87e667d4ace23538d043e4ac023");
  assert.equal(report.creatorId, "16880263281934490");
  assert.equal(report.creatorName, "Zack（曾子豪）");
  assert.equal(report.templateName, "IT部门日报");
  assert.match(report.completedItems, /TMS-优化需求V8B-TCO-创建接口前端对接/);
  assert.equal(report.blockers, "");
  assert.match(report.nextActions, /IMS-优化需求202607-短装策略-记录流水/);
  assert.equal(report.cooperationNeeds, "需要确认数据权限方案");
  assert.equal(report.images, "[]");
  assert.match(report.attachments, /测试跟踪表\.axls/);
  assert.equal(report.extra, sampleRaw);
});

test("normalizeDingTalkReport survives empty and malformed inputs", () => {
  const empty = normalizeDingTalkReport({});
  assert.equal(empty.reportId, "");
  assert.equal(empty.completedItems, "");
  assert.equal(empty.createTime, null);
  const broken = normalizeDingTalkReport({ contents: "not-an-array", create_time: "abc" });
  assert.equal(broken.contents, undefined);
  assert.equal(broken.createTime, null);
});

test("dingtalkReportDate converts create_time to Asia/Shanghai date", () => {
  assert.equal(dingtalkReportDate(1786614638000), "2026-08-13");
  assert.equal(dingtalkReportDate("1786614638000"), "2026-08-13");
  assert.equal(dingtalkReportDate(0), null);
  assert.equal(dingtalkReportDate("invalid"), null);
});

test("dateRangeToMillis converts inclusive YYYY-MM-DD range to +08:00 millis", () => {
  const range = dateRangeToMillis("2026-08-13", "2026-08-13");
  assert.equal(range.start, Date.parse("2026-08-13T00:00:00+08:00"));
  assert.equal(range.end, Date.parse("2026-08-13T23:59:59.999+08:00"));
});

// 构造可注入 fetcher 与内存 store 的测试夹具
async function fixture(reportResponses = [], { now = () => new Date("2026-08-14T00:00:00+08:00") } = {}) {
  const calls = { token: 0, list: [] };
  const fetcher = async (url, options = {}) => {
    if (url.includes("/v1.0/oauth2/accessToken")) {
      calls.token += 1;
      return jsonResponse({ accessToken: "token-1", expireIn: 7200 });
    }
    if (url.includes("/topapi/report/list")) {
      calls.list.push(JSON.parse(options.body));
      return jsonResponse(reportResponses.shift() || { errcode: 0, result: { data_list: [], has_more: false, next_cursor: 0 } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const store = {
    values: new Map(),
    async get(key) { return this.values.get(key); },
    async set(key, value) { this.values.set(key, value); },
    async delete(key) { this.values.delete(key); },
  };
  const service = createDingTalkReportService({
    config: { clientId: "cid", clientSecret: "cs", apiBaseUrl: "https://api.dingtalk.com", topapiBaseUrl: "https://oapi.dingtalk.com", templateName: "IT部门日报" },
    store,
    fetcher,
    now,
  });
  return { service, calls, store };
}

test("fetchReportList paginates with cursor and caches the app token", async () => {
  const { service, calls, store } = await fixture([
    { errcode: 0, result: { data_list: [sampleRaw], has_more: true, next_cursor: 10 } },
    { errcode: 0, result: { data_list: [sampleRaw], has_more: false, next_cursor: 0 } },
  ]);
  const items = await service.fetchReportList({ from: "2026-08-13", to: "2026-08-13" });
  assert.equal(items.length, 2);
  assert.equal(calls.token, 1, "app token should be fetched once and cached");
  assert.equal(calls.list.length, 2, "two pages should be fetched");
  assert.equal(calls.list[0].cursor, 0);
  assert.equal(calls.list[1].cursor, 10);
  assert.equal(calls.list[0].start_time, Date.parse("2026-08-13T00:00:00+08:00"));
  assert.equal(calls.list[0].end_time, Date.parse("2026-08-13T23:59:59.999+08:00"));
  assert.equal(calls.list[0].template_name, "IT部门日报");
  assert.equal(calls.list[0].size, 10);
  assert.ok(store.values.has("app:access-token"), "app token should persist to the store");

  await service.fetchReportList({ from: "2026-08-12", to: "2026-08-12" });
  assert.equal(calls.token, 1, "second fetch should reuse the cached token");
});

test("fetchReportList passes userid filter for personal queries", async () => {
  const { service, calls } = await fixture([]);
  await service.fetchReportList({ from: "2026-08-13", to: "2026-08-13", userId: "16880263281934490" });
  assert.equal(calls.list[0].userid, "16880263281934490");
  assert.equal(calls.list[0].template_name, "IT部门日报");
});

test("fetchReportList clamps today's end_time to now to avoid DingTalk 40035", async () => {
  const current = new Date("2026-08-13T13:30:00.000Z");
  const { service, calls } = await fixture([], { now: () => current });
  await service.fetchReportList({ from: "2026-08-13", to: "2026-08-13", userId: "u-1" });
  assert.equal(calls.list[0].start_time, Date.parse("2026-08-13T00:00:00+08:00"));
  assert.equal(calls.list[0].end_time, current.getTime());
});

test("fetchReportList skips future ranges without calling DingTalk", async () => {
  const { service, calls } = await fixture([], { now: () => new Date("2026-08-13T13:30:00.000Z") });
  const items = await service.fetchReportList({ from: "2026-08-14", to: "2026-08-14", userId: "u-1" });
  assert.deepEqual(items, []);
  assert.equal(calls.list.length, 0);
  assert.equal(calls.token, 0);
});

test("fetchReportList surfaces DingTalk errcode as an error", async () => {
  const { service } = await fixture([{ errcode: 40035, errmsg: "参数错误", result: {} }]);
  await assert.rejects(() => service.fetchReportList({ from: "2026-08-13", to: "2026-08-13" }), { code: "DINGTALK_REPORT_FETCH_FAILED" });
});

test("fetchReportList retries once when the token is invalid (errcode 40014)", async () => {
  const { service, calls } = await fixture([
    { errcode: 40014, errmsg: "invalid access_token", result: {} },
    { errcode: 0, result: { data_list: [sampleRaw], has_more: false, next_cursor: 0 } },
  ]);
  const items = await service.fetchReportList({ from: "2026-08-13", to: "2026-08-13" });
  assert.equal(items.length, 1);
  assert.equal(calls.token, 2, "token should be refetched after 40014");
});

test("fetchReportList requests a fresh token when the persisted one expires", async () => {
  const current = new Date("2026-08-14T00:00:00.000+08:00");
  const { service, calls, store } = await fixture([], { now: () => current });
  store.values.set("app:access-token", { accessToken: "stale", expiresAt: new Date(current.getTime() - 60_000).toISOString() });
  await service.fetchReportList({ from: "2026-08-13", to: "2026-08-13" });
  assert.equal(calls.token, 1, "expired persisted token should trigger a fresh exchange");
});
