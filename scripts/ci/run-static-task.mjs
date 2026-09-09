import { spawnSync } from "node:child_process";

const task = required(process.env.STATIC_TASK, "STATIC_TASK");
const project = process.env.STATIC_PROJECT?.trim();
const changedPaths = parseJsonArray(process.env.STATIC_CHANGED_PATHS);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const args = commandFor(task, project, changedPaths);
const result = spawnSync(pnpm, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.signal) throw new Error(`static task 被信号 ${result.signal} 终止。`);
process.exit(result.status ?? 1);

function commandFor(name, projectName, paths) {
  switch (name) {
    case "type-app":
      return ["type-check:app"];
    case "type-tests":
      return ["type-check:tests"];
    case "type-scripts":
      return ["type-check:scripts"];
    case "lint":
      return ["lint"];
    case "lint-changed":
      return ["exec", "eslint", "--max-warnings=0", ...paths];
    case "dead-code":
      return ["exec", "bash", "-c", "pnpm knip && pnpm knip --production"];
    case "build":
      return ["exec", "env", "-u", "DATABASE_URL", "next", "build"];
    default:
      const fullTask = projectName === "unit-domain-node" ? "unit-domain"
        : projectName === "unit-server-node" ? "unit-server"
          : "unit-react";
      if (projectName && (name === fullTask || name === `unit-related-${projectName}`)) {
        if (process.env.STATIC_MODE === "related") {
          return ["exec", "vitest", "related", "--project", projectName, "--run", "--passWithNoTests", ...paths];
        }
        return ["exec", "vitest", "run", "--project", projectName];
      }
      throw new Error(`unknown static task: ${name}`);
  }
}

function parseJsonArray(value) {
  if (!value?.trim() || value.trim() === "null") return [];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("STATIC_CHANGED_PATHS 必须是 JSON 数组。");
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("STATIC_CHANGED_PATHS 必须是字符串数组。");
  }
  return parsed;
}

function required(value, name) {
  if (!value?.trim()) throw new Error(`${name} 未设置。`);
  return value.trim();
}
