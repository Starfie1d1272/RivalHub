import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const task = required(process.env.STATIC_TASK, "STATIC_TASK");
  const project = process.env.STATIC_PROJECT?.trim();
  const changedPaths = parseJsonArray(process.env.STATIC_CHANGED_PATHS, "STATIC_CHANGED_PATHS");
  const relatedSources = parseJsonArray(process.env.STATIC_RELATED_SOURCES, "STATIC_RELATED_SOURCES");
  const explicitTests = parseJsonArray(process.env.STATIC_EXPLICIT_TESTS, "STATIC_EXPLICIT_TESTS");
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  const args = commandFor(task, project, relatedSources, explicitTests, changedPaths);
  const result = spawnSync(pnpm, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.signal) throw new Error(`static task 被信号 ${result.signal} 终止。`);
  process.exit(result.status ?? 1);
}

export function commandFor(name, projectName, relatedSources = [], explicitTests = [], changedPaths = []) {
  switch (name) {
    case "type-app":
      return ["type-check:app"];
    case "type-tests":
      return ["type-check:tests"];
    case "type-scripts":
      return ["type-check:scripts"];
    case "lint":
      return ["lint"];
    case "architecture":
      return ["architecture:check"];
    case "lint-changed":
      return ["exec", "eslint", "--max-warnings=0", ...changedPaths];
    case "dead-code":
      return ["exec", "bash", "-c", "pnpm knip && pnpm knip --production"];
    case "build":
      return ["exec", "env", "-u", "DATABASE_URL", "next", "build"];
    default:
      const fullTask = projectName === "unit-domain-node" ? "unit-domain"
        : projectName === "unit-server-node" ? "unit-server"
          : "unit-react";
      if (projectName && name === `unit-related-${projectName}`) {
        return ["exec", "vitest", "related", "--project", projectName, "--run", "--passWithNoTests", ...relatedSources];
      }
      if (projectName && name === `unit-explicit-${projectName}`) {
        return ["exec", "vitest", "run", "--project", projectName, "--passWithNoTests", ...explicitTests];
      }
      if (projectName && name === fullTask) {
        return ["exec", "vitest", "run", "--project", projectName];
      }
      throw new Error(`unknown static task: ${name}`);
  }
}

function parseJsonArray(value, name) {
  if (!value?.trim() || value.trim() === "null") return [];
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} 必须是 JSON 数组。`);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${name} 必须是字符串数组。`);
  }
  return parsed;
}

function required(value, name) {
  if (!value?.trim()) throw new Error(`${name} 未设置。`);
  return value.trim();
}
