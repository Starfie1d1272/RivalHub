import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const count = Number(process.argv[2] ?? 30);
if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("Specify 1–100 PR runs.");
const repo = (await exec("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])).stdout.trim();
const api = async path => JSON.parse((await exec("gh", ["api", `repos/${repo}/actions/${path}`])).stdout);
const { workflow_runs: runs } = await api(`workflows/ci.yml/runs?event=pull_request&per_page=${count}`);
const groups = new Map();
let unavailable = 0;
const p95 = values => values.length ? [...values].sort((a,b)=>a-b)[Math.ceil(values.length * 0.95) - 1] : null;
for (let offset = 0; offset < runs.length; offset += 4) {
  await Promise.all(runs.slice(offset, offset + 4).map(async run => {
    let jobs = [];
    if (run.status !== "queued") {
      try { ({ jobs } = await api(`runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`)); }
      catch { unavailable++; }
    }
    const active = jobs.filter(job => job.conclusion !== "skipped");
    const gate = active.find(job => job.name === "ci-gate" || job.name === "draft-gate");
    const plan = active.find(job => job.name === "plan");
    const planStart = plan?.steps?.find(step => step.name === "Set up job")?.started_at;
    const names = active.map(job => job.name);
    const full = names.some(name => name === "static / unit-all") ||
      names.filter(name => name.startsWith("postgres / ")).length > 1;
    const lane = full ? "FULL" : ["static", "postgres", "system"]
      .filter(lane => names.some(name => name.startsWith(`${lane} / `))).join("+") ||
      (gate ? "metadata" : "unallocated");
    const key = `${gate?.name ?? "pending"} ${lane}`;
    const group = groups.get(key) ?? { runs: 0, failed: 0, cancelled: 0, queued: 0, rerun: 0, wall: [], allocation: [] };
    group.runs++;
    group.failed += Number(run.conclusion === "failure" || run.conclusion === "startup_failure");
    group.cancelled += Number(run.conclusion === "cancelled");
    group.queued += Number(run.status === "queued");
    group.rerun += Number(run.run_attempt > 1);
    if (gate?.conclusion === "success") group.wall.push(Math.round((Date.parse(gate.completed_at) - Date.parse(run.created_at)) / 1000));
    if (planStart) group.allocation.push(Math.round((Date.parse(planStart) - Date.parse(run.created_at)) / 1000));
    groups.set(key, group);
  }));
}
console.table([...groups].sort(([a],[b])=>a.localeCompare(b)).map(([lane, { wall, allocation, ...counts }]) => ({
  lane, ...counts, successfulGates: wall.length, wallP95Seconds: p95(wall), planAllocationP95Seconds: p95(allocation),
})));

if (unavailable) console.warn(`Unavailable job histories: ${unavailable} of ${runs.length}`);
