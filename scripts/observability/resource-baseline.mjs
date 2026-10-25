// Controlled loopback-only production-build fixture; never targets a deployment.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { assertReleaseIdentity } from "../../src/lib/release/identity.ts";

export async function assertBaselineReadiness(response, expected) {
  if (!response.ok) throw new Error(`Readiness HTTP ${response.status}`);
  let identity;
  try { identity = assertReleaseIdentity(await response.json(), "Local build identity"); }
  catch { throw new Error("Readiness returned invalid build identity"); }
  if (identity.releaseTag !== expected.releaseTag || identity.releaseCommit !== expected.releaseCommit)
    throw new Error("Readiness build identity mismatch");
  return identity;
}

export async function recordBaselineResponse(response, requests, route, phase, started) {
  const bytes = (await response.arrayBuffer()).byteLength;
  const sample = { route, phase, status: response.status, bytes, durationMs: performance.now() - started };
  requests.push(sample);
  if (response.status !== 200) throw new Error(`Unexpected HTTP ${response.status} for ${route}`);
  return sample;
}

async function main() {
  const [envFile, image, output] = process.argv.slice(2);
  if (!envFile || !image || !output) throw new Error("Expected local env file, existing Docker image ID, output directory");
  const env = Object.fromEntries(readFileSync(envFile, "utf8").split("\n").filter(Boolean).map(line => {
    const split = line.indexOf("="); return [line.slice(0, split), line.slice(split + 1)];
  }));
  for (const key of ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
    if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(env[key]).hostname)) throw new Error("Local fixture required");
  }
  if (env.RIVALHUB_DB_TARGET !== "local") throw new Error("Local target required");
  const root = process.cwd();
  const node = realpathSync("node_modules/.bin/node");
  const next = resolve("node_modules/next/dist/bin/next");
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const expectedIdentity = assertReleaseIdentity({ releaseTag: env.RIVALHUB_RELEASE_TAG, releaseCommit: env.RIVALHUB_RELEASE_COMMIT }, "Expected local build identity");
  if (expectedIdentity.releaseCommit !== sha) throw new Error("Local build identity must match checkout SHA");
  const dir = resolve(output);
  mkdirSync(dir, { recursive: true });
  const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const routes = ["/stats", "/teams", "/local-major-2027/bet", "/seasons"];
  const runs = [];
  for (let round = 1; round <= 3; round++) {
    for (const enabled of round % 2 ? [false, true] : [true, false]) {
      const name = `rivalhub-resource-${process.pid}-${round}-${Number(enabled)}`;
      const run = { round, enabled, sha, limits: { memoryBytes: 536870912, cpus: 1, pids: 128 }, phases: [], readiness: [], requests: [] };
      const started = Date.now();
      try {
        docker("run", "--detach", "--user", `${process.getuid()}:${process.getgid()}`, "--name", name, "--network", "host", "--memory", "512m", "--memory-swap", "512m",
          "--cpus", "1", "--pids-limit", "128", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
          "--env-file", resolve(envFile), "--env", `RIVALHUB_RUNTIME_HEALTH_ENABLED=${Number(enabled)}`,
          "--volume", `${root}:${root}`, "--workdir", root, "--entrypoint", node, image, next, "start", "-p", "3107", "-H", "127.0.0.1");
        let ready = false;
        for (let attempt = 0; attempt < 60; attempt++) {
          let response;
          try {
            response = await fetch("http://127.0.0.1:3107/api/system/release", { redirect: "manual", signal: AbortSignal.timeout(2000) });
            const identity = await assertBaselineReadiness(response, expectedIdentity);
            run.readiness.push({ status: response.status, identity });
            ready = true; break;
          } catch {
            run.readiness.push({ status: response?.status ?? null, matched: false });
            await wait(500);
          }
        }
        if (!ready) throw new Error("Local readiness failed: expected 2xx and exact build identity");
        function sample(phase) {
          // Observer cat temporarily shares the cgroup; retain this limitation.
          const values = docker("exec", name, "cat", "/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory.peak",
            "/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/cpu.max", "/sys/fs/cgroup/pids.max").split("\n");
          run.phases.push({ phase, elapsedMs: Date.now() - started, memoryCurrentBytes: Number(values[0]),
            memoryPeakBytes: Number(values[1]), memoryMax: values[2], cpuMax: values[3], pidsMax: values[4] });
        }
        async function request(route, phase) {
          const at = performance.now();
          const response = await fetch(`http://127.0.0.1:3107${route}`, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
          return recordBaselineResponse(response, run.requests, route, phase, at);
        }
        sample("started");
        for (const route of routes) await request(route, "process_cold");
        sample("cold");
        for (const route of routes) await request(route, "warm");
        sample("warm");
        const results = await Promise.allSettled(routes.flatMap(route => Array.from({ length: 3 }, () => request(route, "concurrent12"))));
        if (results.some(result => result.status === "rejected")) throw new Error("Concurrent fixture request failed; retained request samples");
        sample("concurrent12");
        await wait(30_000); sample("idle30s");
        await wait(35_000); sample("idle65s");
        run.state = JSON.parse(docker("inspect", "--format", "{{json .State}}", name));
      } catch (error) { run.failure = error.message; }
      finally {
        if (!run.state) {
          try { run.state = JSON.parse(docker("inspect", "--format", "{{json .State}}", name)); } catch { /* Container may not have started. */ }
        }
        try { writeFileSync(resolve(dir, `${round}-${Number(enabled)}.log`), docker("logs", name)); }
        catch { /* Run failure remains in the result. */ }
        try { docker("rm", "--force", name); } catch { /* No production container name is accepted. */ }
        runs.push(run);
        writeFileSync(resolve(dir, "raw.json"), JSON.stringify({ sha, image, expectedIdentity, scope: "loopback production Next build; local PG; process-cold, artifact cache retained; anonymous HTTP; observer cat included in cgroup peak; no browser or production evidence", runs }, null, 2));
        console.info(JSON.stringify({ round, enabled, failure: run.failure, phases: run.phases }));
      }
    }
  }
  if (runs.some(run => run.failure)) process.exitCode = 1;

}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
