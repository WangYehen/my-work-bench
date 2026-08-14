// 钉钉日志（日报）拉取服务：企业 access token 获取缓存 + /topapi/report/list 分页拉取 + 字段映射
const APP_TOKEN_KEY = "app:access-token";
const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1_000;
const DEFAULT_EXPIRES_IN_SECONDS = 7_200;
const MAX_PAGES = 200;

// 将钉钉日志创建时间（毫秒）转换为上海时区的 YYYY-MM-DD 日期
export function dingtalkReportDate(createTime) {
  const value = Number(createTime);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(value));
}

// 将 YYYY-MM-DD 日期范围转换为上海时区的毫秒时间戳
export function dateRangeToMillis(from, to) {
  return {
    start: Date.parse(`${from}T00:00:00+08:00`),
    end: Date.parse(`${to}T23:59:59.999+08:00`),
  };
}

// 将钉钉日志原始对象映射为工作台日报数据（纯函数，供测试直接断言）
export function normalizeDingTalkReport(raw = {}) {
  const contents = Array.isArray(raw.contents) ? raw.contents : [];
  const valueOf = (key) => String(contents.find((item) => String(item?.key || "") === key)?.value || "");
  return {
    reportId: String(raw.report_id || ""),
    templateName: String(raw.template_name || ""),
    creatorId: String(raw.creator_id || ""),
    creatorName: String(raw.creator_name || ""),
    deptName: String(raw.dept_name || ""),
    createTime: Number(raw.create_time) || null,
    modifiedTime: Number(raw.modified_time) || null,
    remark: String(raw.remark || ""),
    completedItems: valueOf("今日完成工作"),
    blockers: valueOf("今日遗留工作"),
    nextActions: valueOf("明日工作计划"),
    cooperationNeeds: valueOf("需要协作工作"),
    images: valueOf("图片"),
    attachments: valueOf("附件"),
    extra: raw,
  };
}

export function createDingTalkReportService({ config, store, fetcher = globalThis.fetch, now = () => new Date() } = {}) {
  let cached = null;
  let flight = null;

  // 判断缓存 token 是否仍可直接使用（过期前 5 分钟视为不可用）
  function tokenUsable(token) {
    return Boolean(token?.accessToken) && Date.parse(token.expiresAt) - now().getTime() > TOKEN_REFRESH_WINDOW_MS;
  }

  // 通过 client_credentials 换取企业 access token
  async function requestAppToken() {
    const response = await fetcher(`${config.apiBaseUrl || "https://api.dingtalk.com"}/v1.0/oauth2/accessToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appKey: config.clientId, appSecret: config.clientSecret, grantType: "client_credentials" }),
      ...(config.dispatcher ? { dispatcher: config.dispatcher } : {}),
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok || !value.accessToken) {
      const failure = Object.assign(new Error(value.message || value.code || "获取钉钉企业 access token 失败。"), { code: "DINGTALK_TOKEN_FETCH_FAILED", status: response.status });
      throw failure;
    }
    const expiresIn = Number(value.expireIn || value.expires_in || DEFAULT_EXPIRES_IN_SECONDS);
    return { accessToken: String(value.accessToken), expiresAt: new Date(now().getTime() + expiresIn * 1_000).toISOString() };
  }

  // 获取企业 access token：内存缓存 > 持久化存储 > 重新换取（并发去重）
  async function getAppToken() {
    if (cached && tokenUsable(cached)) return cached.accessToken;
    if (flight) return flight;
    flight = (async () => {
      const persisted = store ? await store.get(APP_TOKEN_KEY).catch(() => null) : null;
      if (tokenUsable(persisted)) {
        cached = persisted;
        return cached.accessToken;
      }
      const token = await requestAppToken();
      cached = token;
      if (store) await store.set(APP_TOKEN_KEY, token);
      return token.accessToken;
    })().finally(() => { flight = null; });
    return flight;
  }

  // 失效当前企业 token（钉钉返回 40014 时触发重取）
  async function invalidateAppToken() {
    cached = null;
    if (store?.delete) await store.delete(APP_TOKEN_KEY).catch(() => {});
  }

  // 调用日志列表接口单页，返回 result 对象
  async function fetchPage(token, payload) {
    const url = `${config.topapiBaseUrl || "https://oapi.dingtalk.com"}${config.reportListPath || "/topapi/report/list"}?access_token=${encodeURIComponent(token)}`;
    const response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      ...(config.dispatcher ? { dispatcher: config.dispatcher } : {}),
    });
    const body = await response.json().catch(() => ({}));
    if (Number(body.errcode) !== 0) {
      const failure = Object.assign(new Error(body.errmsg || `钉钉日志接口返回错误 ${body.errcode}。`), {
        code: "DINGTALK_REPORT_FETCH_FAILED",
        errcode: Number(body.errcode),
        status: response.status,
      });
      throw failure;
    }
    return body.result || { data_list: [], has_more: false, next_cursor: 0 };
  }

  // 按日期范围分页拉取日志列表（可选按钉钉 userid 过滤），返回规范化后的数组
  async function fetchReportList({ from, to, userId = null } = {}) {
    const range = dateRangeToMillis(from, to);
    const currentTime = now().getTime();
    // 钉钉会以 40035 拒绝 end_time 晚于当前时刻；查询今天时只拉到“现在”。
    if (range.start > currentTime) return [];
    const payload = {
      start_time: range.start,
      end_time: Math.min(range.end, currentTime),
      template_name: config.templateName || "IT部门日报",
      cursor: 0,
      size: 10,
    };
    if (userId) payload.userid = userId;
    const items = [];
    let cursor = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      payload.cursor = cursor;
      let token = await getAppToken();
      let result;
      try {
        result = await fetchPage(token, payload);
      } catch (failure) {
        if (failure.errcode !== 40014) throw failure;
        await invalidateAppToken();
        token = await getAppToken();
        result = await fetchPage(token, payload);
      }
      items.push(...(result.data_list || []));
      if (!result.has_more) break;
      cursor = Number(result.next_cursor || 0);
      if (!cursor) break;
    }
    return items.map(normalizeDingTalkReport);
  }

  return { fetchReportList, getAppToken, invalidateAppToken };
}
