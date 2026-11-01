import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadLayerManifest } from "../standby/layers.mjs";
import { assertReleaseCapabilities } from "./capability-contract";
import { assertReleaseIdentity, type ReleaseIdentity } from "../../src/lib/release/identity";

const origin = "https://match.starfie1d.top";
const host = "root@47.103.131.158";

/** Both transport failures and semantic smoke failures require reconciliation. */
export async function promoteLinux(deps: {
  assertCapabilities: () => void;
  verifyPrevious: () => Promise<void>;
  deploy: () => Promise<void>;
  verifyCandidate: () => Promise<void>;
  rollback: () => Promise<void>;
  verifyRollback: () => Promise<void>;
}) {
  deps.assertCapabilities();
  await deps.verifyPrevious();
  try {
    await deps.deploy();
    await deps.verifyCandidate();
  } catch (failure) {
    // The SSH connection may have failed after the host changed its symlink.
    deps.assertCapabilities();
    try {
      await deps.rollback();
      await deps.verifyRollback();
    } catch (rollbackFailure) {
      throw new AggregateError([failure, rollbackFailure], "Linux release failed; rollback unverified. Inspect the host transaction before retry.");
    }
    throw new Error("Linux release failed; previous production identity restored.", { cause: failure });
  }
}

export async function verifyIdentity(expected: ReleaseIdentity) {
  const response = await fetch(`${origin}/api/system/release`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Canonical release HTTP ${response.status}`);
  const actual = assertReleaseIdentity(await response.json());
  if (JSON.stringify(Object.keys(actual).sort()) !== '["releaseCommit","releaseTag"]'
    || actual.releaseTag !== expected.releaseTag || actual.releaseCommit !== expected.releaseCommit) throw new Error("Canonical release identity differs from the frozen target.");
}

export async function verifyCanonical(expected: ReleaseIdentity) {
  const deadline = Date.now() + 120_000;
  do {
    try {
      await verifyIdentity(expected);
      const home = await fetch(`${origin}/`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      await home.body?.cancel();
      if (!home.ok) throw new Error(`Canonical homepage HTTP ${home.status}`);
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
  } while (true);
}

async function main() {
  console.log(JSON.stringify({ event: "linux.release_stage", stage: "package_validation" }));
  const candidate = assertReleaseIdentity({ releaseTag: process.env.RELEASE_TAG, releaseCommit: process.env.RELEASE_SHA });
  const previous = assertReleaseIdentity({ releaseTag: process.env.RIVALHUB_PREVIOUS_RELEASE_TAG, releaseCommit: process.env.RIVALHUB_PREVIOUS_RELEASE_COMMIT });
  const key = process.env.LINUX_DEPLOY_SSH_KEY;
  const knownHosts = process.env.LINUX_DEPLOY_KNOWN_HOSTS;
  if (!key?.includes("PRIVATE KEY") || !knownHosts?.includes("[47.103.131.158]:52222")) throw new Error("Protected Linux SSH credential and pinned host key required.");
  const packageDir = resolve(".agent-tmp/standby-production-package");
  const files = readdirSync(packageDir);
  const layers = files.filter(name => /^rivalhub-production-[a-f0-9]{40}-[a-f0-9]{12}\.layers\.json$/.test(name));
  if (layers.length > 1) throw new Error("Exactly one layered Linux package required.");
  const layered = layers.length === 1 ? loadLayerManifest(join(packageDir, layers[0])) : undefined;
  const archives = files.filter(name => /^rivalhub-production-[a-f0-9]{40}-[a-f0-9]{12}\.tar\.gz$/.test(name));
  if (!layered && archives.length !== 1) throw new Error("Exactly one immutable Linux package required.");
  const archive = layered ? layers[0] : archives[0];
  const manifest = layered ?? JSON.parse(readFileSync(join(packageDir, archive.replace(/\.tar\.gz$/, ".json")), "utf8"));
  const hash = createHash("sha256").update(readFileSync(join(packageDir, archive))).digest("hex");
  const operator = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (manifest.sourceCommit !== candidate.releaseCommit || manifest.releaseTag !== candidate.releaseTag || manifest.operatorCommit !== operator
    || (!layered && manifest.sha256 !== hash) || readFileSync(join(packageDir, `${archive}.sha256`), "utf8").trim() !== `${hash}  ${archive}`) throw new Error("Package checksum or candidate identity mismatch.");
  const temp = mkdtempSync(join(tmpdir(), "rivalhub-release-"));
  const remote = `/root/rivalhub-release-${candidate.releaseCommit}-${randomUUID()}`;
  writeFileSync(join(temp, "key"), key + "\n", { mode: 0o600 });
  writeFileSync(join(temp, "known_hosts"), knownHosts + "\n", { mode: 0o600 });
  const options = ["-i", join(temp, "key"), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${join(temp, "known_hosts")}`, "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3"];
  const ssh = (command: string) => execFileSync("ssh", [...options, "-p", "52222", host, command], { stdio: "inherit", timeout: 300_000 });
  const pair = `${candidate.releaseTag} ${candidate.releaseCommit} ${previous.releaseTag} ${previous.releaseCommit}`;
  let result = "failed";
  try {
    // Setup failures occur before any application mutation.
    console.log(JSON.stringify({ event: "linux.release_stage", stage: "remote_directory" }));
    ssh(`mkdir -m 700 ${remote}`);
    // Native Node TS imports need an explicit extension, as in build-production.
    // Upload the canonical TLS owner, never another connection implementation.
    writeFileSync(join(temp, "postgres-connection.ts"), readFileSync("src/db/postgres-connection.ts", "utf8")
      .replace('from "./supabase-ca"', 'from "./supabase-ca.ts"'));
    const tools = ["scripts/standby/install-production.sh", "scripts/standby/production-host.mjs", "scripts/standby/rivalhub-production.service", "scripts/standby/layers.mjs",
      "scripts/standby/production-quiescence.mjs", "scripts/standby/production-traffic-status.mjs", join(temp, "postgres-connection.ts"), "src/db/supabase-ca.ts"];
    console.log(JSON.stringify({ event: "linux.release_stage", stage: "upload_manifest_and_tools" }));
    const bootstrap = join(temp, "bootstrap");
    mkdirSync(bootstrap, { mode: 0o700 });
    const inputs = [join(packageDir, archive), join(packageDir, `${archive}.sha256`), ...tools];
    for (const input of inputs) copyFileSync(input, join(bootstrap, basename(input)));
    const bundle = join(temp, "bootstrap.tar.gz");
    execFileSync("tar", ["-czf", bundle, "-C", bootstrap, "."]);
    execFileSync("scp", [...options, "-P", "52222", bundle, `${host}:${remote}/`], { stdio: "inherit", timeout: 300_000 });
    ssh(`tar -xzf ${remote}/bootstrap.tar.gz -C ${remote}`);
    if (layered) {
      console.log(JSON.stringify({ event: "linux.release_stage", stage: "layer_inventory" }));
      const missing: unknown = JSON.parse(execFileSync("ssh", [...options, "-p", "52222", host,
        `/opt/rivalhub-production/current/runtime/node ${remote}/layers.mjs missing ${remote}/${archive} /opt/rivalhub-production/layers`], { encoding: "utf8", timeout: 300_000 }));
      if (!Array.isArray(missing) || missing.some(name => typeof name !== "string" || !layered.layers.some(layer => layer.archive === name)) || new Set(missing).size !== missing.length) throw new Error("Invalid remote layer inventory.");
      if (missing.length) {
        console.log(JSON.stringify({ event: "linux.release_stage", stage: "upload_layers" }));
        execFileSync("scp", [...options, "-P", "52222", ...missing.map(name => join(packageDir, name)), `${host}:${remote}/`], { stdio: "inherit", timeout: 300_000 });
      }
      const bytes = layered.layers.filter(layer => missing.includes(layer.archive)).reduce((sum, layer) => sum + layer.bytes, 0);
      console.log(JSON.stringify({ event: "linux.layer_transfer", layers: missing.length, compressedBytes: bytes, reusedLayers: 3 - missing.length }));
    }
    console.log(JSON.stringify({ event: "linux.release_stage", stage: "promotion" }));
    await promoteLinux({
      assertCapabilities: () => assertReleaseCapabilities(process.cwd(), previous.releaseCommit, candidate.releaseCommit),
      verifyPrevious: () => { console.log(JSON.stringify({ event: "linux.release_stage", stage: "verify_previous" })); return verifyIdentity(previous); },
      deploy: async () => { console.log(JSON.stringify({ event: "linux.release_stage", stage: "install" })); ssh(`bash ${remote}/install-production.sh ${remote}/${archive} /etc/rivalhub-production/production.env --release ${pair} && { printf '%s\\n' '{"event":"linux.release_stage","stage":"host_readback"}'; /opt/rivalhub-production/current/runtime/node ${remote}/production-traffic-status.mjs || printf '%s\\n' '{"event":"db_traffic.host_readback","available":false}'; }`); },
      verifyCandidate: () => { console.log(JSON.stringify({ event: "linux.release_stage", stage: "verify_candidate" })); return verifyCanonical(candidate); },
      rollback: async () => { console.log(JSON.stringify({ event: "linux.release_stage", stage: "rollback" })); ssh(`bash ${remote}/install-production.sh --rollback ${pair}`); },
      verifyRollback: () => { console.log(JSON.stringify({ event: "linux.release_stage", stage: "verify_rollback" })); return verifyCanonical(previous); },
    });
    result = "canonical verified";
    console.log(`Linux Production verified: ${candidate.releaseTag} ${candidate.releaseCommit}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
    // Host package and transaction evidence are retained for recovery.
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `\n### Linux release\n- Candidate: ${candidate.releaseTag} (${candidate.releaseCommit})\n- Previous: ${previous.releaseTag} (${previous.releaseCommit})\n- Result: ${result}\n- Host evidence: ${remote}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
