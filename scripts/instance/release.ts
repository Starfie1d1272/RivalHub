import { execFileSync } from "node:child_process";
import { copyFileSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isMigrationLedgerPrefix, readMigrationLedger, type MigrationIdentity } from "../db/migration-ledger";
import { assertReleaseIdentity } from "../../src/lib/release/identity";
import { assertCapabilitySnapshots, readReleaseCapabilities } from "../release/capability-contract";
import { assertInstanceReleaseIdentity } from "../db/recovery/source";

// No existing database or host check prevents a separate writer reconnecting.
function requireWriterFence(): void {
  throw new Error("Major transition unavailable: the instance cannot prove that independent writers are fenced. Keep the current release running until a verified writer-fencing mechanism is available.");
}

// This controller runs on the instance host from the trusted operator checkout.
// The small evidence has the same format and verifier as the release controller.
async function main(): Promise<void> {
  if (process.getuid?.() !== 0) throw new Error("Instance release controller must run as root.");
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const operator = git("rev-parse", "HEAD");
  if (git("status", "--porcelain")) throw new Error("A clean committed operator checkout is required.");
  const temp = mkdtempSync(join(tmpdir(), "rivalhub-instance-release-"));
  try {
    copyFileSync("scripts/standby/release-capability-gate.mjs", join(temp, "release-capability-gate.mjs"));
    copyFileSync("scripts/release/capability-contract.ts", join(temp, "capability-contract.ts"));
    const evidence = join(temp, "capability-evidence.json");
    if (process.argv[2] === "--restore-pair") {
      if (process.argv.length !== 5) throw new Error("Usage: release.ts --restore-pair EVIDENCE RESTORED_INSTANCE_ENV");
      const snapshot = realpathSync(readFileSync("/opt/rivalhub-instance/previous-snapshot", "utf8").trim());
      if (!snapshot.startsWith("/opt/rivalhub-instance/rollback/") || readFileSync(join(snapshot, "operator-commit"), "utf8").trim() !== operator) throw new Error("Paired recovery operator or transaction mismatch.");
      execFileSync("bash", ["scripts/instance/install.sh", "--restore-pair", resolve(process.argv[3]!), resolve(process.argv[4]!)], { stdio: "inherit" });
      return;
    }
    if (process.argv[2] === "--rollback") {
      if (process.argv.length !== 3) throw new Error("Usage: release.ts --rollback");
      const root = "/opt/rivalhub-instance/rollback/";
      const snapshot = realpathSync(readFileSync("/opt/rivalhub-instance/previous-snapshot", "utf8").trim());
      if (!snapshot.startsWith(root)) throw new Error("Invalid instance rollback snapshot.");
      const identity = readFileSync(join(snapshot, "identity"), "utf8").trim().split(/\s+/);
      if (identity.length !== 4 || readFileSync(join(snapshot, "operator-commit"), "utf8").trim() !== operator) throw new Error("Rollback operator or identity mismatch.");
      copyFileSync(join(snapshot, "capability-evidence.json"), evidence);
      execFileSync("bash", ["scripts/instance/install.sh", "--rollback", ...identity, "--capability-evidence", evidence], { stdio: "inherit" });
      return;
    }
    const major = process.argv[2] === "--major-transition";
    if (major) {
      requireWriterFence();
      if (process.argv.length !== 9 || process.argv[5] !== "--checkpoint-env" || process.argv[7] !== "--maintenance-window"
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(process.argv[8] ?? "")) throw new Error("Usage: release.ts --major-transition MANIFEST INSTANCE_ENV --checkpoint-env FILE --maintenance-window ID");
      const archive = resolve(process.argv[3]!);
      const environment = resolve(process.argv[4]!);
      const manifest = JSON.parse(readFileSync(archive, "utf8")) as { sourceCommit?: string; releaseTag?: string; operatorCommit?: string; environment?: string; migrations?: MigrationIdentity[] };
      if (manifest.environment !== "instance" || manifest.sourceCommit !== operator || manifest.operatorCommit !== operator || !manifest.releaseTag) throw new Error("Candidate package and operator checkout differ.");
      const response = await fetch("http://127.0.0.1:3033/api/system/release", { redirect: "error", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Running instance identity unavailable.");
      const previous = assertReleaseIdentity(await response.json(), "running instance identity");
      assertInstanceReleaseIdentity(previous.releaseTag, previous.releaseCommit, process.cwd(), false);
      assertInstanceReleaseIdentity(manifest.releaseTag, operator);
      const installed = JSON.parse(readFileSync("/opt/rivalhub-instance/current/standby.json", "utf8")) as { releaseTag?: string; sourceCommit?: string; migrations?: MigrationIdentity[] };
      const legacy = readMigrationLedger(resolve("drizzle/v2-migrations")), active = readMigrationLedger();
      if (installed.releaseTag !== previous.releaseTag || installed.sourceCommit !== previous.releaseCommit
        || !Array.isArray(installed.migrations) || !installed.migrations.length || !isMigrationLedgerPrefix(installed.migrations, legacy)
        || !Array.isArray(manifest.migrations) || manifest.migrations.length !== active.length || !isMigrationLedgerPrefix(manifest.migrations, active)) throw new Error("Major transition requires an exact v2 source and current v3 target lineage.");
      const before = readReleaseCapabilities(process.cwd(), previous.releaseCommit), after = readReleaseCapabilities(process.cwd(), operator);
      // Validate both immutable contracts individually; cross-version concurrency is not permitted in this transaction.
      assertCapabilitySnapshots(before, before); assertCapabilitySnapshots(after, after);
      const content = JSON.stringify({ version: 2, transition: "instance-v2-to-v3", maintenanceWindow: process.argv[8], operatorCommit: operator,
        previous: { tag: previous.releaseTag, commit: previous.releaseCommit, capabilities: before },
        candidate: { tag: manifest.releaseTag, commit: operator, capabilities: after } });
      if (Buffer.byteLength(content) > 16384) throw new Error("Capability evidence exceeds 16 KiB.");
      writeFileSync(evidence, content, { mode: 0o600 });
      execFileSync("bash", ["scripts/instance/install.sh", archive, environment, "--release", manifest.releaseTag, operator,
        previous.releaseTag, previous.releaseCommit, "--capability-evidence", evidence, "--checkpoint-env", resolve(process.argv[6]!), "--major-transition"], { stdio: "inherit" });
      return;
    }
    const recovering = process.argv[2] === "--recover";
    if ((!recovering && process.argv.length !== 4 && process.argv.length !== 6) || (recovering && process.argv.length !== 6)) throw new Error("Usage: release.ts MANIFEST INSTANCE_ENV [--checkpoint-env FILE] | --recover MANIFEST INSTANCE_ENV EVIDENCE | --rollback");
    if (!recovering && process.argv.length === 6 && process.argv[4] !== "--checkpoint-env") throw new Error("Expected --checkpoint-env FILE.");
    const offset = recovering ? 1 : 0;
    const archive = resolve(process.argv[2 + offset]!);
    const environment = resolve(process.argv[3 + offset]!);
    const manifest = JSON.parse(readFileSync(archive, "utf8")) as { sourceCommit?: string; releaseTag?: string; operatorCommit?: string; environment?: string };
    if (manifest.environment !== "instance" || manifest.sourceCommit !== operator || manifest.operatorCommit !== operator || !manifest.releaseTag) throw new Error("Candidate package and operator checkout differ.");
    let previous: ReturnType<typeof assertReleaseIdentity>;
    let recoveryEvidence: string | undefined;
    if (recovering) {
      recoveryEvidence = resolve(process.argv[5]!);
      const file = lstatSync(recoveryEvidence), parent = statSync(resolve(recoveryEvidence, ".."));
      if (!file.isFile() || file.isSymbolicLink() || file.uid !== 0 || parent.uid !== 0 || (file.mode & 0o077) || (parent.mode & 0o077) || file.size > 65536) throw new Error("Protected recovery evidence required.");
      const recovered = JSON.parse(readFileSync(recoveryEvidence, "utf8"));
      if (recovered.version !== 1 || recovered.artifactKind !== "full") throw new Error("Full recovery evidence required.");
      previous = assertReleaseIdentity({ releaseTag: recovered.source?.deployedReleaseTag, releaseCommit: recovered.source?.deployedCommit }, "restored source identity");
      assertInstanceReleaseIdentity(previous.releaseTag, previous.releaseCommit);
      assertInstanceReleaseIdentity(manifest.releaseTag, operator);
    } else {
      const response = await fetch("http://127.0.0.1:3033/api/system/release", { redirect: "error", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Running instance identity unavailable.");
      previous = assertReleaseIdentity(await response.json(), "running instance identity");
    }
    const before = readReleaseCapabilities(process.cwd(), previous.releaseCommit);
    const after = readReleaseCapabilities(process.cwd(), operator);
    assertCapabilitySnapshots(before, after);
    const content = JSON.stringify({ version: 1, operatorCommit: operator,
      previous: { tag: previous.releaseTag, commit: previous.releaseCommit, capabilities: before },
      candidate: { tag: manifest.releaseTag, commit: operator, capabilities: after } });
    if (Buffer.byteLength(content) > 16384) throw new Error("Capability evidence exceeds 16 KiB.");
    writeFileSync(evidence, content, { mode: 0o600 });
    execFileSync("bash", ["scripts/instance/install.sh", archive, environment, "--release", manifest.releaseTag, operator,
      previous.releaseTag, previous.releaseCommit, "--capability-evidence", evidence, ...(recoveryEvidence ? ["--recovery-evidence", recoveryEvidence] : process.argv.length === 6 ? ["--checkpoint-env", resolve(process.argv[5]!)] : [])], { stdio: "inherit" });
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Instance release failed."); process.exitCode = 1; });
