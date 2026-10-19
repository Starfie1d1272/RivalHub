import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const lanes = ["static", "postgres", "system"];

/** Step timestamps describe runner execution; job.started_at can precede runner allocation. */
export function jobExecutionMilliseconds(job) {
  if (job.conclusion === "skipped") return 0;
  const steps = job.steps?.filter(step => step.conclusion !== "skipped");
  if (!steps?.length) throw new Error(`Missing execution steps: ${job.name}`);
  const intervals = steps.map(step => {
    const start = Date.parse(step.started_at);
    const end = Date.parse(step.completed_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || !step.started_at || !step.completed_at) {
      throw new Error(`Incomplete execution timing: ${job.name}`);
    }
    return [start, end];
  }).sort((a, b) => a[0] - b[0]);
  let elapsed = 0;
  let previousEnd = -Infinity;
  for (const [start, end] of intervals) {
    elapsed += Math.max(0, end - Math.max(start, previousEnd));
    previousEnd = Math.max(previousEnd, end);
  }
  return elapsed;
}

/** CI's graph: plan -> parallel capability lanes; dependency jobs run independently -> gate. */
export function executionBudget(jobs, { requiredJobs, requireReview, gateMilliseconds }) {
  if (!Array.isArray(jobs) || !Array.isArray(requiredJobs) || requiredJobs.some(lane => !lanes.includes(lane))
    || !Number.isFinite(gateMilliseconds) || gateMilliseconds < 0) throw new Error("Invalid execution budget input");
  const durations = new Map();
  for (const job of jobs) {
    if (["ci-gate", "draft-gate"].includes(job.name)) continue;
    const lane = lanes.find(key => job.name.startsWith(`${key} / `));
    const key = lane ?? job.name;
    if (!["plan", "dependency-graph-build", "dependency-review", ...lanes].includes(key)) {
      throw new Error(`Unknown CI timing job: ${job.name}`);
    }
    if (job.conclusion === "skipped") continue;
    durations.set(key, Math.max(durations.get(key) ?? 0, jobExecutionMilliseconds(job)));
  }
  for (const name of ["plan", "dependency-graph-build", ...(requireReview ? ["dependency-review"] : []), ...requiredJobs]) {
    if (!durations.has(name)) throw new Error(`Missing execution timing: ${name}`);
  }
  const capabilityMilliseconds = Math.max(0, ...lanes.map(lane => durations.get(lane) ?? 0));
  const executionMilliseconds = Math.max(
    durations.get("plan") + capabilityMilliseconds,
    durations.get("dependency-graph-build"),
    durations.get("dependency-review") ?? 0,
  ) + gateMilliseconds;
  return { executionMilliseconds, gateMilliseconds, jobs: Object.fromEntries(durations) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const flag = name => {
      const index = args.indexOf(name);
      if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
      return args[index + 1];
    };
    const jobs = readFileSync(flag("--jobs"), "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
    const result = executionBudget(jobs, {
      requiredJobs: JSON.parse(process.env.REQUIRED_JOBS),
      requireReview: process.env.GITHUB_EVENT_NAME === "pull_request",
      gateMilliseconds: Number(flag("--gate-ms")),
    });
    console.log(JSON.stringify(result));
    const recorded = spawnSync(process.execPath, ["scripts/ci/timing.mjs", "record",
      "--label", "required gate execution critical path", "--start-ms", "0", "--end-ms", String(result.executionMilliseconds),
      "--budget-ms", flag("--budget-ms")], { stdio: "inherit" });
    process.exitCode = recorded.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
