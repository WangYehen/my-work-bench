import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const files = (await readdir("tests"))
  .filter((file) => file.endsWith(".test.mjs"))
  .sort()
  .map((file) => path.join("tests", file));
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files], { stdio: "inherit" });
process.exit(result.status || 0);
