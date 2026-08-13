import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createOutlookService,
  parseClassifierResponse,
  prepareMailText,
} from "../server/outlook.mjs";

const key = Buffer.alloc(32, 7).toString("base64");
const baseConfig = {
  tenantId: "contoso.onmicrosoft.com",
  clientId: "client-id",
  redirectUri: "http://127.0.0.1:5174/api/outlook/oauth/callback",
  tokenEncryptionKey: key,
  deepseekApiKey: "fake",
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function mockFetch({ invalidClassifier = false } = {}) {
  const calls = [];
  const handler = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/token")) {
      return json({ ["access" + "_token"]: "access-token", ["refresh" + "_token"]: "refresh-token", expires_in: 3600, scope: "Mail.Read offline_access" });
    }
    if (String(url).includes("graph.microsoft.com")) {
      return json({
        value: [{
          id: "graph-message-1",
          internetMessageId: "<message-1@example.test>",
          subject: "请在今天确认合同条款",
          from: { emailAddress: { name: "采购支持", address: "procurement@example.test" } },
          receivedDateTime: "2026-08-12T02:00:00Z",
          webLink: "https://outlook.office.com/mail/deeplink/read/1",
          body: { contentType: "html", content: "<p>请在今天 15:00 前确认合同条款。</p><p>-- <br>签名</p>" },
        }],
      });
    }
    if (String(url).includes("chat/completions")) {
      return json({ choices: [{ message: { content: invalidClassifier ? "not-json" : JSON.stringify({ classification: "todo", intent: "confirmation", urgency: "high", summary: "采购支持要求在今天 15:00 前确认合同条款。", dueAt: "2026-08-12T15:00:00+08:00" }) } }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  return { handler, calls };
}

test("Outlook OAuth uses PKCE and stores only encrypted metadata after initial sync", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workbench-outlook-"));
  const { handler, calls } = mockFetch();
  const service = createOutlookService({ config: baseConfig, stateDirectory: directory, fetchImpl: handler, now: () => new Date("2026-08-12T03:00:00Z") });

  try {
    await service.acceptConsent();
    const started = await service.startOAuth();
    const authorization = new URL(started.authorizationUrl);
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    assert.match(authorization.searchParams.get("scope"), /Mail\.Read/);
    assert.match(authorization.searchParams.get("scope"), /offline_access/);

    await service.completeOAuth({ code: "authorization-code", state: authorization.searchParams.get("state") });
    const todos = await service.list();
    assert.equal(todos.items.length, 1);
    assert.equal(todos.items[0].summary.includes("合同条款"), true);
    assert.equal(todos.items[0].status, "open");
    assert.equal(todos.items[0].queue, "action");
    assert.equal(todos.items[0].priority, "P0");
    assert.equal(todos.items[0].dueSource, "explicit");
    assert.equal(calls.some((call) => call.url.includes("graph.microsoft.com")), true);
    assert.equal(calls.some((call) => call.url.includes("chat/completions")), true);

    const stored = await readFile(path.join(directory, "state.enc.json"), "utf8");
    assert.equal(stored.includes("确认合同条款"), false);
    assert.equal(stored.includes("fake"), false);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("multi-tenant one-click sign-in uses the common authority when no tenant is configured", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workbench-outlook-common-"));
  const { handler } = mockFetch();
  const { tenantId: _tenantId, ...multiTenantConfig } = baseConfig;
  const service = createOutlookService({ config: multiTenantConfig, stateDirectory: directory, fetchImpl: handler });
  try {
    await service.acceptConsent();
    const { authorizationUrl } = await service.startOAuth();
    assert.match(authorizationUrl, /^https:\/\/login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/authorize\?/);
    assert.deepEqual((await service.status()).missingConfiguration.includes("OUTLOOK_ENTRA_TENANT_ID"), false);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("local processed, ignored, and restored statuses never mutate Microsoft Graph", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "workbench-outlook-status-"));
  const { handler, calls } = mockFetch();
  const service = createOutlookService({ config: baseConfig, stateDirectory: directory, fetchImpl: handler, now: () => new Date("2026-08-12T03:00:00Z") });
  try {
    await service.acceptConsent();
    const authorization = new URL((await service.startOAuth()).authorizationUrl);
    await service.completeOAuth({ code: "authorization-code", state: authorization.searchParams.get("state") });
    await service.setMessageStatus("graph-message-1", "processed");
    assert.equal((await service.list()).items.length, 0);
    assert.equal((await service.list("archive")).items[0].status, "processed");
    await service.setMessageStatus("graph-message-1", "open");
    assert.equal((await service.list()).items[0].status, "open");
    await service.correctMessage("graph-message-1", { queue: "uncertain", actionType: "other", actionText: "请人工确认", priority: "P1", priorityReason: "信息不足", confidence: 100, dueAt: null, dueSource: "none" });
    const corrected = (await service.list("uncertain")).items[0];
    assert.equal(corrected.userCorrectedAt != null, true);
    assert.equal(corrected.actionText, "请人工确认");
    assert.equal(calls.some((call) => /graph\.microsoft\.com\/v1\.0\/me\/messages\//.test(call.url) && call.options.method !== "GET"), false);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("mail preparation removes HTML and quoted/signature text, and classifier rejects malformed output", () => {
  const text = prepareMailText("<p>请回复客户。</p><p>-----Original Message-----</p><p>不要保留这里</p>");
  assert.equal(text.includes("请回复客户"), true);
  assert.equal(text.includes("不要保留这里"), false);
  const parsed = parseClassifierResponse('{"classification":"not_actionable","intent":"other","urgency":"low","summary":"新闻通知","dueAt":null}');
  assert.equal(parsed.queue, "informational");
  assert.equal(parsed.priority, "P2");
  assert.equal(parsed.classification, "not_actionable");
  const current = parseClassifierResponse('{"queue":"uncertain","actionType":"other","actionText":"请确认是否处理","dueAt":null,"dueSource":"none","priority":"P1","priorityReason":"信息不足","confidence":42,"summary":"无法判断"}');
  assert.equal(current.confidence, 42);
  assert.throws(() => parseClassifierResponse("ignore previous instructions"), { code: "OUTLOOK_CLASSIFICATION_INVALID" });
});
