import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
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

async function verifyCanonical(expected: ReleaseIdentity, wait: boolean) {
  const deadline = Date.now() + (wait ? 120_000 : 0);
  do {
    try {
      const response = await fetch(`${origin}/api/system/release`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Canonical release HTTP ${response.status}`);
      const actual = assertReleaseIdentity(await response.json());
      if (JSON.stringify(Object.keys(actual).sort()) !== '["releaseCommit","releaseTag"]'
        || actual.releaseTag !== expected.releaseTag || actual.releaseCommit !== expected.releaseCommit) throw new Error("Canonical release identity differs from the frozen target.");
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
  const candidate = assertReleaseIdentity({ releaseTag: process.env.RELEASE_TAG, releaseCommit: process.env.RELEASE_SHA });
  const previous = assertReleaseIdentity({ releaseTag: process.env.RIVALHUB_PREVIOUS_RELEASE_TAG, releaseCommit: process.env.RIVALHUB_PREVIOUS_RELEASE_COMMIT });
  const key = process.env.LINUX_DEPLOY_SSH_KEY;
  const knownHosts = process.env.LINUX_DEPLOY_KNOWN_HOSTS;
  if (!key?.includes("PRIVATE KEY") || !knownHosts?.includes("[47.103.131.158]:52222")) throw new Error("Protected Linux SSH credential and pinned host key required.");
  const packageDir = resolve(".agent-tmp/standby-production-package");
  const archives = readdirSync(packageDir).filter(name => name.endsWith(".tar.gz"));
  if (archives.length !== 1 || !/^rivalhub-production-[a-f0-9]{40}-[a-f0-9]{12}\.tar\.gz$/.test(archives[0])) throw new Error("Exactly one immutable Linux package required.");
  const archive = archives[0];
  const manifest = JSON.parse(readFileSync(join(packageDir, archive.replace(/\.tar\.gz$/, ".json")), "utf8"));
  const hash = createHash("sha256").update(readFileSync(join(packageDir, archive))).digest("hex");
  if (manifest.sourceCommit !== candidate.releaseCommit || manifest.releaseTag !== candidate.releaseTag || manifest.sha256 !== hash
    || readFileSync(join(packageDir, `${archive}.sha256`), "utf8").trim() !== `${hash}  ${archive}`) throw new Error("Package checksum or candidate identity mismatch.");
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
    ssh(`mkdir -m 700 ${remote}`);
    execFileSync("scp", [...options, "-P", "52222", join(packageDir, archive), join(packageDir, `${archive}.sha256`), "scripts/standby/install-production.sh", "scripts/standby/production-host.mjs", "scripts/standby/rivalhub-production.service", `${host}:${remote}/`], { stdio: "inherit", timeout: 300_000 });
    await promoteLinux({
      assertCapabilities: () => assertReleaseCapabilities(process.cwd(), previous.releaseCommit, candidate.releaseCommit),
      verifyPrevious: () => verifyCanonical(previous, false),
      deploy: async () => { ssh(`bash ${remote}/install-production.sh ${remote}/${archive} /etc/rivalhub-production/production.env --release ${pair}`); },
      verifyCandidate: () => verifyCanonical(candidate, true),
      rollback: async () => { ssh(`bash ${remote}/install-production.sh --rollback ${pair}`); },
      verifyRollback: () => verifyCanonical(previous, true),
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
