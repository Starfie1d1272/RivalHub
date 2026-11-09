import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const FULL_CHECKS = ["format", "type-app", "type-tests", "type-scripts", "lint", "architecture", "dead-code", "deployment"];
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const task = process.env.STATIC_TASK;

let failed = false;
for (const check of checksFor(task)) {
  try {
    const args = commandFor(check);
    const result = spawnSync(process.execPath, ["scripts/ci/timing.mjs", `static/${check.task}`, "--", pnpm, ...args], {
      env: { ...process.env, RIVALHUB_TIMING_TEST_KIND: check.task.startsWith("unit") ? "unit" : "" },
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`static/${check.task} 被信号 ${result.signal} 终止。`);
    if (result.status !== 0) failed = true;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    failed = true;
  }
}
if (failed) process.exitCode = 1;

function checksFor(name) {
  if (name === "checks") return FULL_CHECKS.map(task => ({ task }));
  if (name !== "affected") return [{ task: name }];
  const checks = JSON.parse(process.env.STATIC_CHECKS ?? "null");
  if (!Array.isArray(checks) || !checks.length) throw new Error("Missing affected static tasks");
  return checks;
}

function commandFor({ task, project, relatedSources, explicitTests, changedPaths }) {
  switch (task) {
    case "format":
      return ["format:check"];
    case "type-app":
    case "type-tests":
    case "type-scripts":
      return [`type-check:${task.slice(5)}`];
    case "lint":
      return ["lint"];
    case "architecture":
      return ["architecture:check"];
    case "lint-changed":
      return ["exec", "eslint", "--max-warnings=0", ...changedPaths];
    case "dead-code":
      return ["exec", "bash", "-c", "pnpm knip && pnpm knip --production"];
    case "build":
      return ["exec", "node", "scripts/ci/hermetic-production-build.mjs"];
    case "deployment":
      return ["exec", "node", "--test",
        "scripts/standby/install-production.test.mjs", "scripts/standby/production-quiescence.test.mjs",
        "scripts/standby/production-traffic-status.test.mjs"];
    case "unit-all":
      return ["exec", "vitest", "run"];
    case "unit-related":
      return ["exec", "vitest", "related", "--run", "--passWithNoTests", ...relatedSources];
    default:
      if (project && task === `unit-explicit-${project}`) {
        assertExplicitTests(project, explicitTests);
        return ["exec", "vitest", "run", "--project", project, ...explicitTests];
      }
      throw new Error(`unknown static task: ${task}`);
  }
}

function assertExplicitTests(project, paths) {
  if (!paths.length) throw new Error("explicit test selection must not be empty");
  const discovery = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "list", "--project", project, "--filesOnly", ...paths, "--json"], { encoding: "utf8" });
  if (discovery.error) throw discovery.error;
  if (discovery.status !== 0) throw new Error(`explicit test discovery failed: ${discovery.stderr}`);
  const discovered = new Set(JSON.parse(discovery.stdout).map(item => resolve(item.file)));
  const missing = paths.filter(path => !discovered.has(resolve(path)));
  if (missing.length) throw new Error(`explicit tests were not discovered in ${project}: ${missing.join(", ")}`);
}
