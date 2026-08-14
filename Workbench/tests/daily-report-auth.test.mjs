import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("web team auth persists a versioned token and clears it on logout", async () => {
  const source = await readFile(new URL("../src/lib/daily-reports.js", import.meta.url), "utf8");
  assert.match(source, /workbench:team-auth:v1/);
  assert.match(source, /readStoredToken/);
  assert.match(source, /persistToken\(remoteToken\)/);
  assert.match(source, /clearStoredToken\(\)/);
  assert.match(source, /response\.status === 401/);
});

test("electron DingTalk auth remains on the IPC bridge", async () => {
  const source = await readFile(new URL("../src/lib/daily-reports.js", import.meta.url), "utf8");
  assert.match(source, /bridge\(\)\?\.dingtalkStart\(\)/);
  assert.match(source, /bridge\(\)\.dingtalkExchange\(loginToken\)/);
  assert.match(source, /bridge\(\)\.logout\(\)/);
});
