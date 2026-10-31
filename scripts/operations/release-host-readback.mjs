// Fixed read-only probe executed over the existing protected release SSH channel.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync, statSync, statfsSync } from "node:fs";

const root = "/opt/rivalhub-production";
const lockPath = `${root}/deploy.lock`;

export function lockHolders(locks, stat) {
  const dev = stat.dev;
  const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n);
  const minor = (dev & 0xffn) | ((dev >> 12n) & 0xffffff00n);
  const matching = locks.split("\n").filter(line => {
    const fields = line.trim().split(/\s+/);
    const i = fields.findIndex(value => /^[0-9a-f]+:[0-9a-f]+:\d+$/i.test(value));
    if (i < 0 || !fields.includes("FLOCK")) return false;
    const [a, b, inode] = fields[i].split(":");
    return BigInt(`0x${a}`) === major && BigInt(`0x${b}`) === minor && BigInt(inode) === stat.ino;
  });
  return { held: matching.filter(line => !line.includes("->")).length, waiting: matching.filter(line => line.includes("->")).length };
}

export function classifyProcess(command) {
  if (/install-production\.sh|production-quiescence\.mjs|layers\.mjs|\/root\/rivalhub-release-/.test(command)) return "release";
  if (/(^|\/)sftp-server(?:\s|$)|(^|\/)scp(?:\s|$)|internal-sftp/.test(command)) return "transfer";
  return null;
}

function sample() {
  let lock = null;
  try { lock = lockHolders(readFileSync("/proc/locks", "utf8"), statSync(lockPath, { bigint: true })); }
  catch { /* Null means unknown, never unlocked. */ }
  const counts = { release: 0, transfer: 0 }; let incomplete = false;
  let pids = [];
  try { pids = readdirSync("/proc").filter(value => /^\d+$/.test(value)); } catch { incomplete = true; }
  for (const pid of pids) {
    try {
      const kind = classifyProcess(readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " "));
      if (kind) counts[kind]++;
    } catch (error) { if (error.code !== "ENOENT" && error.code !== "ESRCH") incomplete = true; }
  }
  return { lock, processes: counts, processScanComplete: !incomplete };
}

// Incident-specific, bounded journal read. Only fixed aggregates leave the host.
function journalSummary() {
  const sinceUtc = "2026-10-31T07:45:00.000Z";
  const untilUtc = new Date(Math.floor(Math.min(Date.now(), Date.parse("2026-10-31T12:00:00.000Z")) / 1000) * 1000).toISOString();
  const result = { sinceUtc, untilUtc, status: "unavailable", errorCode: "invalid_window", rows: [], scopedStatus: "unavailable", scopedRows: [] };
  if (untilUtc < sinceUtc) return result;
  const journalTime = value => value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  const journal = spawnSync("/usr/bin/journalctl", ["--namespace=*", "--unit=rivalhub-production", `--since=${journalTime(sinceUtc)}`, `--until=${journalTime(untilUtc)}`, "--output=cat", "--no-pager", "--grep=mizar\\.(reliable\\.reject|live\\.(outcome_window|stage_window|broadcast_unavailable))"], { encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (journal.error) {
    const codes = { ENOENT: "binary_missing", EACCES: "execute_denied", ETIMEDOUT: "timeout", ENOBUFS: "output_limit" };
    result.errorCode = codes[journal.error.code] ?? "execution_error";
    return result;
  }
  if (journal.status !== 0 && !(journal.status === 1 && !journal.stdout && !journal.stderr)) {
    const stderr = journal.stderr ?? "";
    result.errorCode = /permission denied|access denied/i.test(stderr) ? "read_denied" :
      /no journal files were found/i.test(stderr) ? "journal_missing" :
      /unrecognized option|unknown option/i.test(stderr) ? "unsupported_option" :
      /failed to parse.*(timestamp|date|time)/i.test(stderr) ? "invalid_time" : "journal_failed";
    return result;
  }
  const reliable = new Set(["context_stale", "sequence_stale", "generation_fence", "epoch_fence", "authority_changed", "idempotency_conflict", "invalid_schema", "auth_failed", "other"]);
  const phases = new Set(["auth", "read", "validate", "domain", "revalidation"]);
  const outcomes = new Set(["accepted", "frame_expired", "contended", "delivery_dropped", "broadcast_unavailable", "rejected", "error"]);
  const stages = new Set(["received", "admitted", "authorized", "send_success", "expired", "capacity", "contended", "unknown_send"]);
  const kinds = new Set(["match_started", "map_started", "map_ended", "map_player_snapshot", "series_ended", "source_generation_changed", "map_epoch_changed", "identity_mismatch", "lineup_mismatch"]);
  const counts = new Map();
  const scopedCounts = new Map();
  let scopedIncomplete = false;
  let incomplete = false;
  function add(event, reason, status, count) {
    const key = JSON.stringify([event, reason, status]);
    const next = (counts.get(key) ?? 0) + count;
    if (!Number.isSafeInteger(next)) { incomplete = true; return; }
    counts.set(key, next);
  }
  for (const line of journal.stdout.split("\n")) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { incomplete = true; continue; }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) { incomplete = true; continue; }
    const context = entry.safeContext ?? {};
    if (entry.event === "mizar.live.broadcast_unavailable") { add(entry.event, null, "records", 1); continue; }
    if (entry.event === "mizar.reliable.reject") {
      if (!reliable.has(context.reason)) { incomplete = true; continue; }
      const reason = context.reason;
      if (Number.isSafeInteger(context.firstAt) && context.firstAt >= 0 && Number.isSafeInteger(context.lastAt) && context.lastAt >= context.firstAt && Number.isSafeInteger(context.count) && context.count > 1) {
        add(entry.event, reason, "window_records", 1);
        add(entry.event, reason, "window_reported_count", context.count);
      } else if (context.count === 1 && phases.has(context.phase)) {
        add(entry.event, reason, "first_records", 1);
        if (reason === "epoch_fence" && context.scopeHash === "42b0e08fee7e6b69") {
          if (!kinds.has(context.kind) || !Number.isSafeInteger(context.receivedCursor) || context.receivedCursor < 0 || !Number.isSafeInteger(context.storedCursor) || context.storedCursor < 0 || typeof entry.timestamp !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry.timestamp)) scopedIncomplete = true;
          else {
            const key = JSON.stringify([`${entry.timestamp.slice(0, 16)}:00Z`, context.kind, context.receivedCursor, context.storedCursor]);
            if (!scopedCounts.has(key) && scopedCounts.size >= 100) scopedIncomplete = true;
            else scopedCounts.set(key, (scopedCounts.get(key) ?? 0) + 1);
          }
        }
      }
      else incomplete = true;
      continue;
    }
    const allowed = entry.event === "mizar.live.outcome_window" ? outcomes : entry.event === "mizar.live.stage_window" ? stages : null;
    if (!allowed) continue;
    if (!allowed.has(context.outcome) || !Number.isSafeInteger(context.count) || context.count < 0) { incomplete = true; continue; }
    add(entry.event, context.outcome, "reported_count", context.count);
  }
  result.status = incomplete ? "incomplete" : "ok";
  result.errorCode = incomplete ? "invalid_record" : null;
  result.rows = [...counts].map(([key, count]) => { const [event, reason, status] = JSON.parse(key); return { event, reason, status, count }; });
  result.scopedStatus = incomplete || scopedIncomplete ? "incomplete" : "ok";
  result.scopedRows = [...scopedCounts].map(([key, count]) => { const [minute, kind, receivedEpoch, storedEpoch] = JSON.parse(key); return { minute, kind, receivedEpoch, storedEpoch, count }; });
  return result;
}

async function main() {
  let manifest = null, local = null, service = null, diskAvailableBytes = null;
  try {
    const current = readlinkSync(`${root}/current`);
    if (!/^releases\/rivalhub-production-[a-f0-9-]+$/.test(current)) throw new Error();
    const value = JSON.parse(readFileSync(`${root}/${current}/standby.json`, "utf8"));
    if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.releaseTag) || !/^[a-f0-9]{40}$/.test(value.sourceCommit)) throw new Error();
    manifest = { releaseTag: value.releaseTag, releaseCommit: value.sourceCommit };
  } catch { /* Unavailable identity must not suppress lock evidence. */ }
  try {
    const response = await fetch("http://127.0.0.1:3032/api/system/release", { signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!response.ok) throw new Error();
    const value = await response.json();
    if (Object.keys(value).sort().join(",") !== "releaseCommit,releaseTag" || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.releaseTag) || !/^[a-f0-9]{40}$/.test(value.releaseCommit)) throw new Error();
    local = value;
  } catch { /* Service may be stopped during a release. */ }
  try { const value = execFileSync("systemctl", ["show", "rivalhub-production", "--property=ActiveState", "--value"], { encoding: "utf8", timeout: 5000 }).trim(); if (["active", "inactive", "failed", "activating", "deactivating", "reloading"].includes(value)) service = value; } catch { /* Unknown remains null. */ }
  try { const fs = statfsSync(root, { bigint: true }); const bytes = Number(fs.bavail * fs.bsize); if (Number.isSafeInteger(bytes)) diskAvailableBytes = bytes; } catch { /* Unknown remains null. */ }
  const first = sample(); await new Promise(resolve => setTimeout(resolve, 1000)); const second = sample();
  console.log(JSON.stringify({ event: "linux.release_host_readback", manifest, local, service, diskAvailableBytes, first, second, journal: journalSummary() }));
}

if (process.argv[1] === "-") main().catch(() => { console.error("Host readback unavailable"); process.exitCode = 1; });
