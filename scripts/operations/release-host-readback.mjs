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
function journalSummary(budget) {
  const sinceUtc = "2026-10-31T13:00:00.000Z";
  const untilUtc = new Date(Math.floor(Math.min(Date.now(), Date.parse("2026-10-31T15:00:00.000Z")) / 1000) * 1000).toISOString();
  const result = { sinceUtc, untilUtc, status: "unavailable", errorCode: "invalid_window", rows: [], failureRows: [] };
  if (untilUtc < sinceUtc) return result;
  const journalTime = value => value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  const journal = spawnSync("/usr/bin/journalctl", ["--namespace=*", "--unit=rivalhub-production", `--since=${journalTime(sinceUtc)}`, `--until=${journalTime(untilUtc)}`, "--output=cat", "--no-pager", "--grep=(mizar\\.(reliable\\.reject|live\\.(outcome_window|stage_window|broadcast_unavailable)|request\\.failure)|db\\.query\\.(failure|outcome_unknown|retry))"], { encoding: "utf8", timeout: Math.max(1, budget.deadline - Date.now()), maxBuffer: budget.bytes, stdio: ["ignore", "pipe", "pipe"] });
  budget.bytes = Math.max(0, budget.bytes - Buffer.byteLength(journal.stdout ?? "") - Buffer.byteLength(journal.stderr ?? ""));
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
  const codes = new Set(["55P03", "57014", "40001", "40P01", "08000", "08001", "08003", "08006", "57P01", "57P03", "53300", "ECONNRESET", "ETIMEDOUT"]);
  const classes = new Set(["database", "application", "dependency", "expected", "security", "invariant"]);
  const counts = new Map();
  const failureCounts = new Map();
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
    const isLiveFailure = entry.event === "mizar.request.failure" && entry.operation === "live";
    const isMizarQuery = ["db.query.failure", "db.query.outcome_unknown", "db.query.retry"].includes(entry.event) && entry.route === "/api/mizar/[operation]";
    if (isLiveFailure || isMizarQuery) {
      const timestamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
      if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== entry.timestamp || entry.timestamp < sinceUtc || entry.timestamp > untilUtc) { incomplete = true; continue; }
      const code = codes.has(entry.errorCode) ? entry.errorCode : "other_or_missing";
      const errorClass = classes.has(entry.errorClass) ? entry.errorClass : "other_or_missing";
      const phase = isLiveFailure && phases.has(context.phase) ? context.phase : "not_recorded";
      const status = isLiveFailure && context.httpStatus === 500 ? "500" : "not_recorded";
      const key = JSON.stringify([`${entry.timestamp.slice(0, 16)}:00Z`, entry.event, code, errorClass, phase, status]);
      if (!failureCounts.has(key) && failureCounts.size >= 100) incomplete = true;
      else failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1);
      continue;
    }
    if (entry.event === "mizar.live.broadcast_unavailable") { add(entry.event, null, "records", 1); continue; }
    if (entry.event === "mizar.reliable.reject") {
      if (!reliable.has(context.reason)) { incomplete = true; continue; }
      const reason = context.reason;
      if (Number.isSafeInteger(context.firstAt) && context.firstAt >= 0 && Number.isSafeInteger(context.lastAt) && context.lastAt >= context.firstAt && Number.isSafeInteger(context.count) && context.count > 1) {
        add(entry.event, reason, "window_records", 1);
        add(entry.event, reason, "window_reported_count", context.count);
      } else if (context.count === 1 && phases.has(context.phase)) add(entry.event, reason, "first_records", 1);
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
  result.failureRows = [...failureCounts].map(([key, count]) => { const [minute, event, code, errorClass, phase, status] = JSON.parse(key); return { minute, event, code, errorClass, phase, status, count }; });
  return result;
}

// Fixed rolling window; journal cat output has no reliable process boundary.
function statsJournalSummary(budget) {
  const untilMs = Math.floor(Date.now() / 1000) * 1000;
  const sinceUtc = new Date(untilMs - 60 * 60 * 1000).toISOString();
  const untilUtc = new Date(untilMs).toISOString();
  const result = { sinceUtc, untilUtc, status: "unavailable", errorCode: "budget_exhausted",
    bucketMinutes: 10, semantics: "latest_observed_cumulative", processBoundary: "unavailable", delta: null, rows: [] };
  if (budget.deadline <= Date.now() || budget.bytes < 1) return result;
  const journalTime = value => value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  const journal = spawnSync("/usr/bin/journalctl", ["--namespace=*", "--unit=rivalhub-production", `--since=${journalTime(sinceUtc)}`,
    `--until=${journalTime(untilUtc)}`, "--output=cat", "--no-pager", "--grep=runtime\\.read\\.sample"],
  { encoding: "utf8", timeout: Math.max(1, budget.deadline - Date.now()), maxBuffer: budget.bytes, stdio: ["ignore", "pipe", "pipe"] });
  budget.bytes = Math.max(0, budget.bytes - Buffer.byteLength(journal.stdout ?? "") - Buffer.byteLength(journal.stderr ?? ""));
  if (journal.error) {
    const codes = { ENOENT: "binary_missing", EACCES: "execute_denied", ETIMEDOUT: "timeout", ENOBUFS: "output_limit" };
    result.errorCode = codes[journal.error.code] ?? "execution_error"; return result;
  }
  if (journal.status !== 0 && !(journal.status === 1 && !journal.stdout && !journal.stderr)) {
    result.errorCode = /permission denied|access denied/i.test(journal.stderr ?? "") ? "read_denied" : "journal_failed"; return result;
  }
  const families = ["lineup.historical", "lineup.realtime", "lineup.style", "platform", "benchmark"];
  const reasons = ["mizar.canonicalized_new", "mizar.canonicalized_duplicate", "dak.evidence", "stats.projection_rebuild", "scoreboard", "identity", "veto", "season_or_other"];
  const operations = new Set([
    ...families.flatMap(family => ["readCalls", "fillStarted", "fillSucceeded", "fillFailed"].map(metric => `stats.cache.${family}.${metric}`)),
    ...reasons.flatMap(reason => ["attempted", "completed", "failed"].map(metric => `stats.invalidation.${reason}.${metric}`)),
  ]);
  const dashboardEndpoints = ["database", "analysis", "history", "long_window"];
  const dashboardReasons = ["capacity", "configuration", "http_status", "timeout", "network", "body_missing", "body_limit", "json", "schema", "internal"];
  const dashboardStages = ["admission", "config", "transport", "body", "json", "schema", "cache"];
  const dashboardOperations = new Set(dashboardEndpoints.flatMap(endpoint => dashboardReasons.flatMap(reason =>
    dashboardStages.map(stage => `telemetry.dashboard.${endpoint}.${reason}.${stage}`))));
  const buckets = new Map(), dashboardLatest = new Map(); let incomplete = false;
  for (const line of journal.stdout.split("\n")) {
    if (!line) continue;
    let entry; try { entry = JSON.parse(line); } catch { incomplete = true; continue; }
    if (entry?.event !== "runtime.read.sample" || (!operations.has(entry.operation) && !dashboardOperations.has(entry.operation))) continue;
    const timestamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
    const count = entry.safeContext?.count;
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== entry.timestamp || timestamp < untilMs - 60 * 60 * 1000 || timestamp > untilMs ||
      !Number.isSafeInteger(count) || count < 0) { incomplete = true; continue; }
    const bucket = new Date(Math.floor(timestamp / 600000) * 600000).toISOString();
    if (dashboardOperations.has(entry.operation)) {
      const httpStatus = entry.safeContext?.httpStatus, durationMs = entry.safeContext?.durationMs;
      if ((httpStatus !== undefined && (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) ||
        (durationMs !== undefined && (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0))) { incomplete = true; continue; }
      const previous = dashboardLatest.get(entry.operation);
      if (!previous || timestamp >= previous.timestamp) dashboardLatest.set(entry.operation, { bucket, operation: entry.operation, count, httpStatus, durationMs, timestamp });
      continue;
    }
    const key = `${bucket}/${entry.operation}`;
    const previous = buckets.get(key);
    if (!previous || timestamp >= previous.timestamp) buckets.set(key, { bucket, operation: entry.operation, count, timestamp });
  }
  result.status = incomplete ? "incomplete" : "ok";
  result.errorCode = incomplete ? "invalid_record" : null;
  result.rows = [...buckets.values()].map(({ bucket, operation, count }) => [bucket, operation, count]);
  const dashboard = [...dashboardLatest.values()].sort((a, b) => b.timestamp - a.timestamp);
  result.dashboardTruncated = dashboard.length > 80;
  result.dashboardRows = dashboard.slice(0, 80).map(({ bucket, operation, count, httpStatus, durationMs }) => [bucket, operation, count, httpStatus ?? null, durationMs ?? null]);
  if (result.dashboardTruncated) { result.status = "incomplete"; result.errorCode = "output_limit"; }
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
  const journalBudget = { deadline: Date.now() + 30000, bytes: 16 * 1024 * 1024 };
  const journal = journalSummary(journalBudget);
  const statsJournal = statsJournalSummary(journalBudget);
  console.log(JSON.stringify({ event: "linux.release_host_readback", manifest, local, service, diskAvailableBytes, first, second, journal, statsJournal }));
}

if (process.argv[1] === "-") main().catch(() => { console.error("Host readback unavailable"); process.exitCode = 1; });
