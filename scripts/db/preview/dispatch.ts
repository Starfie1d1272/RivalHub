import { spawnSync } from "node:child_process";

const repository = "Starfie1d1272/RivalHub";
const workflow = "refresh-preview-mirror.yml";
const previewUrl = "https://preview-standby.starfie1d.top";
const api = `repos/${repository}/actions`;

function capture(program: string, args: string[], input?: string) {
  const result = spawnSync(program, args, { encoding: "utf8", input, timeout: 60_000 });
  if (result.error || result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${program} ${args[0]} 执行失败。`);
  }
  return result.stdout.trim();
}

function gh(args: string[], input?: string) {
  return capture("gh", args, input);
}

function migrationCommit() {
  const dirty = capture("git", ["status", "--porcelain", "--", "drizzle/migrations"]);
  if (dirty) throw new Error("迁移目录有未提交的修改。请提交并推送迁移，或用 --source-only 恢复生产镜像的 schema。");
  const localTree = capture("git", ["rev-parse", "HEAD:drizzle/migrations"]);
  const main = gh(["api", `repos/${repository}/commits/main`, "--jq", ".sha"]);
  if (!/^[a-f0-9]{40}$/.test(main)) throw new Error("未能解析受保护 main 的提交。");
  const mainTree = gh(["api", `repos/${repository}/contents/drizzle?ref=${main}`, "--jq", '.[] | select(.name == "migrations") | .sha']);
  if (localTree === mainTree) return main;
  const sha = capture("git", ["rev-parse", "HEAD"]);
  const remoteSha = gh(["api", `repos/${repository}/commits/${sha}`, "--jq", ".sha"]);
  if (remoteSha !== sha) throw new Error("GitHub 上没有当前迁移提交。请推送后重试。");
  return sha;
}

function latestRun() {
  const result = gh(["run", "list", "-R", repository, "--workflow", workflow,
    "--branch", "main", "--event", "workflow_dispatch", "--limit", "1", "--json", "databaseId", "--jq", ".[0].databaseId"]);
  if (!/^\d+$/.test(result)) throw new Error("没有可恢复的 Preview 镜像刷新记录。");
  return result;
}

function dispatch(sourceOnly: boolean) {
  const inputs = { apply_current_migrations: sourceOnly ? "false" : "true", migration_commit: sourceOnly ? "" : migrationCommit() };
  const result = JSON.parse(gh(["api", "--method", "POST", `${api}/workflows/${workflow}/dispatches`, "--input", "-"], JSON.stringify({
    ref: "main", inputs, return_run_details: true,
  }))) as { workflow_run_id?: number };
  if (!Number.isSafeInteger(result.workflow_run_id) || result.workflow_run_id! <= 0)
    throw new Error("GitHub 未返回刷新 run ID。请从该 workflow 查看状态。");
  return String(result.workflow_run_id);
}

function watch(run: string) {
  return spawnSync("gh", ["run", "watch", "-R", repository, run, "--interval", "60", "--compact", "--exit-status"], {
    stdio: "inherit",
    timeout: 70 * 60_000,
  }).status === 0;
}

function runState(run: string) {
  return JSON.parse(gh(["run", "view", "-R", repository, run, "--json", "status,conclusion,jobs"])) as {
    status: string;
    conclusion: string;
    jobs: Array<{ name: string; conclusion: string }>;
  };
}

function retryImport(run: string, { jobs }: ReturnType<typeof runState>) {
  if (!jobs.some((job) => job.name === "export encrypted mirror" && job.conclusion === "success")
    || !jobs.some((job) => job.name === "decrypt and refresh rivalhub-dev" && job.conclusion === "failure")) return false;
  const artifact = gh(["api", `${api}/runs/${run}/artifacts`, "--jq",
    `.artifacts[] | select(.name == "preview-mirror-encrypted-${run}" and .expired == false) | .id`]);
  if (!/^\d+$/.test(artifact)) return false;
  if (latestRun() !== run) throw new Error("有更新的刷新请求。请查看最新的运行结果。");
  gh(["run", "rerun", "-R", repository, run, "--failed"]);
  return true;
}

function main(args: string[]) {
  if (args.length > 1 || (args[0] && !["--source-only", "--retry"].includes(args[0])))
    throw new Error("用法  pnpm db:preview:refresh [--source-only | --retry]");
  const resume = args[0] === "--retry";
  const run = resume ? latestRun() : dispatch(args[0] === "--source-only");
  console.log(`Preview 刷新记录 https://github.com/${repository}/actions/runs/${run}`);
  const before = resume ? runState(run) : undefined;
  if (before?.status === "completed" && before.conclusion !== "success" && !retryImport(run, before))
    throw new Error("最新运行没有可以复用的失败导入及加密产物。");
  let success = watch(run);
  if (!success && !resume) {
    const state = runState(run);
    if (state.status !== "completed" || retryImport(run, state)) success = watch(run);
  }
  if (!success) throw new Error("Preview 刷新未完成。请查看上方运行状态。");
  console.log(`Preview 镜像可用 ${previewUrl}`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
