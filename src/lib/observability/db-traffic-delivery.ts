import { readExitCapsules, deleteExitCapsules, isolateInvalidCapsules } from "./db-traffic-capsule";
import { dbTrafficQualityReasons, digestDbTraffic } from "./db-traffic-contract";
import { DbTrafficSpool, type SpoolItem, type SpoolState } from "./db-traffic-spool";

const HOUR = 3600000;
const MAX_BYTES = 10 * 1024 * 1024;
type Batch = { id: string; process: string; release: string; deployment: string; at: number; receivedBytes: number };
type Result = { ok: boolean; status: number | null; retryAfter: number | null; limit: string | null };
type Send = (item: SpoolItem, gap: boolean) => Promise<Result>;
type Identity = { process: string; release: string; deployment: string };
type GapReason = "overflow" | "expired" | "rejected" | "identity_conflict";
const unknownIdentity: Identity = { process: "00000000-0000-0000-0000-000000000000", release: "unknown", deployment: "unknown" };
function markCoverage(state: SpoolState, at: number, identity: Identity = unknownIdentity) {
  state.coverageUnknownSince = Math.min(state.coverageUnknownSince ?? at, at);
  state.coverageRevision = (state.coverageRevision ?? (state.coverageReportedSince === state.coverageUnknownSince ? 0 : 1)) + 1;
  state.coverageIdentity = { process: identity.process, release: identity.release, deployment: identity.deployment };
}
function queueBytes(state: SpoolState): number { return state.batches.reduce((n, item) => n + Buffer.byteLength(item.body), 0); }
function delay(attempts: number): number { return Math.min(60 * 60 * 1000, 1000 * 2 ** Math.min(attempts, 11)) * (0.75 + Math.random() * 0.5); }

/** Called under the single spool owner, committing removal and evidence together. */
async function gapFor(state: SpoolState, item: SpoolItem, reason: GapReason, now: number) {
  const batch = JSON.parse(item.body) as Batch;
  const certainty = item.attempted ? "unconfirmed" : "lost";
  // An unsent gap may be combined without changing an identity already seen by the Worker.
  const bucket = state.gaps.find(entry => {
    if (entry.attempted) return false;
    const value = JSON.parse(entry.body) as { process: string; release: string; deployment: string; start: number; reason: string; certainty: string };
    return value.process === batch.process && value.release === batch.release && value.deployment === batch.deployment && Math.floor(value.start / HOUR) === Math.floor(batch.at / HOUR) && value.reason === reason && value.certainty === certainty;
  });
  if (bucket) {
    const value = JSON.parse(bucket.body) as { start: number; end: number; reportedAt: number; batches: number; receivedBytes: number; truncated: boolean };
    value.start = Math.min(value.start, batch.at); value.end = Math.max(value.end, batch.at); value.reportedAt = now;
    if (value.batches + 1 > 1e12 || value.receivedBytes + batch.receivedBytes > 1e12) { value.truncated = true; markCoverage(state, batch.at, batch); }
    else { value.batches++; value.receivedBytes += batch.receivedBytes; }
    bucket.body = JSON.stringify(value); bucket.digest = await digestDbTraffic(value); bucket.at = now;
    return;
  }
  if (state.gaps.length >= 32) {
    markCoverage(state, batch.at, batch);
    return;
  }
  const body = { id: crypto.randomUUID(), process: batch.process, release: batch.release, deployment: batch.deployment, reportedAt: now, start: batch.at, end: batch.at, reason, certainty, batches: 1, receivedBytes: batch.receivedBytes, truncated: false, coverageUnknownSince: state.coverageUnknownSince };
  state.gaps.push({ id: body.id, body: JSON.stringify(body), digest: await digestDbTraffic(body), at: now, attempted: false, nextAttemptAt: Math.max(now, state.globalNextAttemptAt, state.gapNextAttemptAt), attempts: 0 });
}

/** Owner must serialize calls; failed writes are surfaced and never silently downgraded. */
export class DbTrafficDelivery {
  constructor(private readonly spool: DbTrafficSpool, private readonly identity: Identity) {}
  private async ensureCoverage(state: SpoolState, now: number): Promise<void> {
    const at = state.coverageUnknownSince;
    if (at === null || (state.coverageRevision ?? 0) <= (state.coverageReportedRevision ?? 0) || now < (state.coverageNextAttemptAt ?? 0) || state.gaps.length >= 32 || state.gaps.some(item => (JSON.parse(item.body) as { reason: string }).reason === "unknown_tail")) return;
    const body = { id: crypto.randomUUID(), ...(state.coverageIdentity ?? unknownIdentity), reportedAt: now, start: now, end: now, reason: "unknown_tail", certainty: "unknown", batches: 0, receivedBytes: 0, truncated: true, coverageUnknownSince: at };
    state.gaps.push({ id: body.id, body: JSON.stringify(body), digest: await digestDbTraffic(body), at: now, attempted: false, nextAttemptAt: Math.max(now, state.globalNextAttemptAt, state.gapNextAttemptAt), attempts: 0, coverageRevision: state.coverageRevision });
  }
  async start(now: number): Promise<void> {
    const state = this.spool.snapshot();
    if (state.coverageRevision === undefined) { state.coverageRevision = state.coverageUnknownSince === null || state.coverageReportedSince === state.coverageUnknownSince ? 0 : 1; state.coverageReportedRevision = 0; }
    // Recover all capsules in one state commit. Protect recovered IDs from
    // eviction until every capsule is deleted, making a crash after commit safe.
    const { files, invalid } = await readExitCapsules(this.spool.directory);
    // Scan every candidate before selecting any: conflicts quarantine all
    // affected capsules; an existing durable spool entry always wins.
    const identities = new Map<string, Set<string>>();
    for (const file of files) for (const body of file.capsule.batches) {
      const value = JSON.parse(body) as Batch;
      const bodies = identities.get(value.id) ?? new Set<string>(); bodies.add(body); identities.set(value.id, bodies);
    }
    const conflicts = new Set<string>();
    for (const [id, bodies] of identities) {
      const existing = state.batches.find(item => item.id === id);
      if (bodies.size > 1 || (existing && !bodies.has(existing.body))) conflicts.add(id);
    }
    const capsules = files.filter(file => {
      if (!file.capsule.batches.some(body => conflicts.has((JSON.parse(body) as Batch).id))) return true;
      invalid.push({ name: file.name, at: file.at }); return false;
    });
    for (const item of invalid) markCoverage(state, Math.min(now, item.at));
    const recovered = new Map<string, { body: string; value: Batch }>();
    for (const file of capsules) {
      if (file.capsule.unknownAt !== null) markCoverage(state, file.capsule.unknownAt);
      for (const body of file.capsule.batches) {
        const value = JSON.parse(body) as Batch;
        recovered.set(value.id, { body, value });
      }
    }
    if (recovered.size > 256 || [...recovered.values()].reduce((sum, item) => sum + Buffer.byteLength(item.body), 0) > MAX_BYTES) throw new Error("exit capsules exceed spool capacity");
    for (const { body, value } of recovered.values()) {
      const existing = state.batches.find(item => item.id === value.id);
      if (existing) { if (existing.body !== body) throw new Error("exit capsule identity conflict"); continue; }
      while (state.batches.length >= 256 || queueBytes(state) + Buffer.byteLength(body) > MAX_BYTES) {
        const index = state.batches.findIndex(item => !recovered.has(item.id));
        if (index < 0) throw new Error("exit capsules exceed spool capacity");
        const [removed] = state.batches.splice(index, 1); await gapFor(state, removed, "overflow", now);
      }
      state.batches.push({ id: value.id, body, digest: await digestDbTraffic(value), at: value.at, attempted: false, nextAttemptAt: Math.max(now, state.globalNextAttemptAt, dbTrafficQualityReasons(value).length ? state.quarantineNextAttemptAt : 0), attempts: 0 });
    }
    if (state.openWindowSince !== null) markCoverage(state, Math.min(now, state.openWindowSince), state.openWindowIdentity ?? unknownIdentity);
    if (this.spool.orphanSince !== null) markCoverage(state, Math.min(now, this.spool.orphanSince));
    state.openWindowSince = now; state.openWindowIdentity = this.identity;
    await this.ensureCoverage(state, now);
    await this.spool.commit(state);
    if (invalid.length) {
      try { process.stderr.write('{"event":"db_traffic.invalid_exit_capsule"}\n'); } catch { /* Diagnostics must not block delivery. */ }
      await isolateInvalidCapsules(this.spool.directory, invalid);
    }
    await deleteExitCapsules(this.spool.directory, capsules);
    await this.spool.cleanupOrphans();
  }
  async seal(body: string, now: number, coverageUnknownSince?: number, snapshotCapturedAt = now): Promise<void> {
    const value = JSON.parse(body) as Batch;
    const state = this.spool.snapshot();
    if (coverageUnknownSince !== undefined) markCoverage(state, coverageUnknownSince, this.identity);
    const existing = state.batches.find(item => item.id === value.id);
    if (existing) {
      if (existing.body !== body) throw new Error("spool identity conflict");
      if (coverageUnknownSince !== undefined) { await this.ensureCoverage(state, now); await this.spool.commit(state); }
      return;
    }
    const item: SpoolItem = { id: value.id, body, digest: await digestDbTraffic(value), at: value.at, attempted: false, nextAttemptAt: Math.max(now, state.globalNextAttemptAt, dbTrafficQualityReasons(value).length ? state.quarantineNextAttemptAt : 0), attempts: 0 };
    while (state.batches.length >= 256 || queueBytes(state) + Buffer.byteLength(body) > MAX_BYTES) {
      const removed = state.batches.shift();
      if (!removed) throw new Error("batch exceeds spool capacity");
      await gapFor(state, removed, "overflow", now);
    }
    state.batches.push(item);
    await this.ensureCoverage(state, now);
    state.openWindowSince = snapshotCapturedAt; state.openWindowIdentity = this.identity;
    await this.spool.commit(state);
  }
  async rejectUnsafe(body: string, now: number, coverageUnknownSince?: number, snapshotCapturedAt = now): Promise<void> {
    const value = JSON.parse(body) as Batch;
    const state = this.spool.snapshot();
    const receivedBytes = Number.isSafeInteger(value.receivedBytes) && value.receivedBytes >= 0 && value.receivedBytes <= 1e12 ? value.receivedBytes : 0;
    markCoverage(state, Math.min(value.at, coverageUnknownSince ?? value.at), value);
    const safe = { id: value.id, process: value.process, release: value.release, deployment: value.deployment, at: value.at, receivedBytes };
    await gapFor(state, { id: safe.id, body: JSON.stringify(safe), digest: "", at: safe.at, attempted: false, nextAttemptAt: now, attempts: 0 }, "rejected", now);
    await this.ensureCoverage(state, now); state.openWindowSince = snapshotCapturedAt; state.openWindowIdentity = this.identity;
    await this.spool.commit(state);
  }
  async prune(now: number): Promise<void> {
    const state = this.spool.snapshot();
    const expiredGaps = state.gaps.filter(item => item.at < now - 7 * 86400000);
    const expiredBatches = state.batches.filter(item => item.at < now - 23 * HOUR);
    if (!expiredGaps.length && !expiredBatches.length) return;
    for (const item of expiredGaps) { const start = (JSON.parse(item.body) as { start: number }).start; markCoverage(state, start); }
    state.gaps = state.gaps.filter(item => item.at >= now - 7 * 86400000);
    state.batches = state.batches.filter(item => item.at >= now - 23 * HOUR);
    for (const item of expiredBatches) await gapFor(state, item, "expired", now);
    await this.ensureCoverage(state, now);
    await this.spool.commit(state);
  }
  async drain(send: Send, now: () => number = Date.now, budget: { maxAttempts: number; deadline: number; onAttempt(): void } = { maxAttempts: 8, deadline: now() + 20000, onAttempt() {} }): Promise<void> {
    let attempts = 0;
    { const state = this.spool.snapshot(); await this.ensureCoverage(state, now()); await this.spool.commit(state); }
    for (let steps = 0; steps < 264 && attempts < budget.maxAttempts && now() + 5000 <= budget.deadline; steps++) {
      let state = this.spool.snapshot();
      const expiredGap = state.gaps.find(item => item.at < now() - 7 * 86400000);
      if (expiredGap) {
        const start = (JSON.parse(expiredGap.body) as { start: number }).start;
        markCoverage(state, start);
        state.gaps = state.gaps.filter(item => item.id !== expiredGap.id);
        await this.ensureCoverage(state, now());
        await this.spool.commit(state); continue;
      }
      const expired = state.batches.find(item => item.at < now() - 23 * HOUR);
      if (expired) {
        state.batches = state.batches.filter(item => item.id !== expired.id);
        await gapFor(state, expired, "expired", now());
        await this.spool.commit(state); continue;
      }
      const candidates = [...state.batches.map(item => ({ item, gap: false })), ...state.gaps.map(item => ({ item, gap: true }))].filter(entry => entry.item.nextAttemptAt <= now()).sort((a, b) => a.item.nextAttemptAt - b.item.nextAttemptAt || a.item.at - b.item.at);
      const candidate = candidates[0]; if (!candidate) return;
      candidate.item.attempted = true; candidate.item.attempts++;
      await this.spool.commit(state);
      let result: Result;
      attempts++; budget.onAttempt();
      try { result = await send(candidate.item, candidate.gap); }
      catch { result = { ok: false, status: null, retryAfter: null, limit: null }; }
      state = this.spool.snapshot();
      const list = candidate.gap ? state.gaps : state.batches;
      const item = list.find(entry => entry.id === candidate.item.id); if (!item) continue;
      if (result.ok) {
        state.globalFailures = 0; state.globalNextAttemptAt = 0;
        if (candidate.gap) {
          const gap = JSON.parse(item.body) as { reason: string; coverageUnknownSince: number | null };
          if (gap.reason === "unknown_tail") { state.coverageReportedSince = gap.coverageUnknownSince; state.coverageReportedRevision = Math.max(state.coverageReportedRevision ?? 0, item.coverageRevision ?? 0); }
          state.gaps = state.gaps.filter(entry => entry.id !== item.id);
        }
        else state.batches = state.batches.filter(entry => entry.id !== item.id);
      } else if ([400, 409, 410, 413].includes(result.status ?? 0)) {
        if (candidate.gap) {
          const gap = JSON.parse(item.body) as { reason: string; start: number; coverageUnknownSince: number | null };
          if (gap.reason === "unknown_tail") state.coverageNextAttemptAt = now() + HOUR;
          else markCoverage(state, gap.start);
          state.gaps = state.gaps.filter(entry => entry.id !== item.id);
        }
        else { state.batches = state.batches.filter(entry => entry.id !== item.id); await gapFor(state, item, result.status === 409 ? "identity_conflict" : result.status === 410 ? "expired" : "rejected", now()); }
      } else {
        const global = result.status === null || result.status === 408 || (result.status ?? 0) >= 500 || ((result.status ?? 0) >= 200 && (result.status ?? 0) < 300) || result.status === 401 || result.status === 403 || (result.status === 429 && result.limit !== "gap" && result.limit !== "quarantine");
        if (global) state.globalFailures++;
        const backoff = result.retryAfter !== null ? result.retryAfter * 1000 : delay(global ? state.globalFailures : item.attempts);
        item.nextAttemptAt = Math.ceil(now() + backoff);
        if (global) {
          state.globalNextAttemptAt = item.nextAttemptAt;
          for (const other of [...state.batches, ...state.gaps]) other.nextAttemptAt = Math.max(other.nextAttemptAt, item.nextAttemptAt);
        } else if (result.status === 429 && result.limit === "gap") {
          state.gapNextAttemptAt = item.nextAttemptAt;
          for (const other of state.gaps) other.nextAttemptAt = Math.max(other.nextAttemptAt, item.nextAttemptAt);
        } else if (result.status === 429 && result.limit === "quarantine") {
          state.quarantineNextAttemptAt = item.nextAttemptAt;
          for (const other of state.batches) if (dbTrafficQualityReasons(JSON.parse(other.body)).length) other.nextAttemptAt = Math.max(other.nextAttemptAt, item.nextAttemptAt);
        }
      }
      await this.ensureCoverage(state, now());
      await this.spool.commit(state);
    }
  }
}
