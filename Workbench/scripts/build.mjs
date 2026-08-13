import { spawnSync } from "node:child_process";

const npmExecutable = process.platform === "win32" ? "npx.cmd" : "npx";
const build = spawnSync(npmExecutable, ["vite", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, VITE_WORKBENCH_HOSTED: "true" },
});
if (build.status !== 0) process.exit(build.status || 1);

const prepare = spawnSync(process.execPath, ["scripts/prepare-sites-build.mjs"], { stdio: "inherit", env: process.env });
process.exit(prepare.status || 0);
