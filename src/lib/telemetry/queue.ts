import { LIMITS, type Bootstrap, type TelemetryEvent } from "./protocol";

type Batch = { body: string; bytes: number; endpoint: string; ticket: string; expiresAt: number; events: TelemetryEvent[]; attempts: number };
/** Lossy, memory-only, bounded delivery. Retries preserve the exact envelope and identity. */
export class TelemetryQueue {
  private events: TelemetryEvent[] = [];
  private pending: Batch | null = null;
  private busy = false;
  private nextAttempt = 0;
  private rejectedTicket: string | null = null;
  readonly metrics = { events: 0, dropped: 0, requests: 0, bytes: 0, failures: 0 };
  // Local numeric diagnostics only. Never sent separately, including when policy disables collection.
  readonly delivery = { eligible: 0, accepted: 0, queue_dropped: 0, batch_oversize: 0, schema_reject: 0,
    ticket_expired: 0, ticket_reject: 0, network_retry: 0, server_retry: 0, rate_limit: 0,
    http_reject: 0, stale: 0, identity_reset: 0, retry_exhausted: 0 };
  constructor(private config: Bootstrap, private readonly send: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  configure(config: Bootstrap) {
    if (config.identity !== this.config.identity) {
      this.delivery.identity_reset += this.events.length + (this.pending?.events.length ?? 0);
      this.metrics.dropped += this.events.length + (this.pending?.events.length ?? 0);
      this.events = []; this.pending = null; this.nextAttempt = 0;
    }
    if (config.ticket !== this.config.ticket) this.rejectedTicket = null;
    this.config = config;
  }

  add(event: TelemetryEvent) {
    this.delivery.eligible++;
    if (Date.now() >= this.config.expiresAt) { this.delivery.ticket_expired++; this.metrics.dropped++; return; }
    this.metrics.events++;
    if (event.kind === "performance") {
      const index = this.events.findIndex(previous => previous.kind === "performance" && previous.id === event.id && previous.session === event.session);
      if (index >= 0) { this.events[index] = event; return; }
    }
    if (this.events.length >= LIMITS.queue) { this.events.shift(); this.metrics.dropped++; this.delivery.queue_dropped++; }
    this.events.push(event);
  }

  private pack(): Batch | null {
    const id = crypto.randomUUID();
    const events: TelemetryEvent[] = [];
    let body = ""; let bytes = 0;
    while (this.events.length && events.length < LIMITS.batch) {
      const event = this.events[0];
      if (events.length && event.session !== events[0].session) break;
      const candidate = JSON.stringify({ v: 1, ticket: this.config.ticket, id, events: [...events, event] });
      const size = new TextEncoder().encode(candidate).byteLength;
      if (size > LIMITS.bytes) {
        if (events.length) break;
        this.events.shift(); this.metrics.dropped++; this.delivery.batch_oversize++;
        continue;
      }
      this.events.shift(); events.push(event); body = candidate; bytes = size;
    }
    return events.length ? { body, bytes, endpoint: this.config.endpoint, ticket: this.config.ticket,
      expiresAt: this.config.expiresAt, events, attempts: 0 } : null;
  }

  async flush() {
    const now = Date.now();
    if (this.busy || now < this.nextAttempt) return;
    const fresh = this.events.filter(event => event.at > now - LIMITS.ageMs);
    this.delivery.stale += this.events.length - fresh.length; this.metrics.dropped += this.events.length - fresh.length;
    this.events = fresh;
    if (this.pending && (this.pending.expiresAt <= now || this.pending.events.some(event => event.at <= now - LIMITS.ageMs))) {
      this.delivery[this.pending.expiresAt <= now ? "ticket_expired" : "stale"] += this.pending.events.length;
      this.metrics.dropped += this.pending.events.length; this.pending = null;
    }
    if (!this.pending && now < this.config.expiresAt && this.rejectedTicket !== this.config.ticket) this.pending = this.pack();
    if (!this.pending) return;
    const batch = this.pending;
    this.busy = true;
    batch.attempts++;
    this.metrics.requests++;
    this.metrics.bytes += batch.bytes;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.send(batch.endpoint, {
        method: "POST", body: batch.body, headers: { "Content-Type": "text/plain" },
        credentials: "omit", referrerPolicy: "no-referrer", keepalive: true, signal: controller.signal,
      });
      if (this.pending !== batch) return;
      if (response.ok) {
        this.delivery.accepted += batch.events.length; this.pending = null; this.nextAttempt = Date.now() + 1000;
      } else {
        this.metrics.failures++;
        if (response.status === 429 || response.status >= 500) {
          this.delivery[response.status === 429 ? "rate_limit" : "server_retry"]++;
          const raw = response.status === 429 ? response.headers.get("Retry-After") : null;
          const retryAfter = raw === null ? 0 : /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now();
          this.retry(batch, Number.isFinite(retryAfter) ? retryAfter : 0);
        } else {
          this.delivery[response.status === 400 ? "schema_reject" : response.status === 413 ? "batch_oversize" : response.status === 401 ? "ticket_reject" : "http_reject"] += batch.events.length;
          if (response.status === 401) this.rejectedTicket = batch.ticket;
          this.metrics.dropped += batch.events.length; this.pending = null;
          // A rejected ticket is never replayed with a fresh ticket. Existing bootstrap renewal owns recovery.
        }
      }
    } catch {
      if (this.pending !== batch) return;
      this.metrics.failures++; this.delivery.network_retry++; this.retry(batch);
    } finally { clearTimeout(timeout); this.busy = false; }
  }

  private retry(batch: Batch, retryAfter = 0) {
    this.nextAttempt = Date.now() + Math.min(4 * LIMITS.flushMs, Math.max(retryAfter, LIMITS.flushMs * 2 ** (batch.attempts - 1)));
    if (batch.attempts >= 3) {
      this.metrics.dropped += batch.events.length; this.delivery.retry_exhausted += batch.events.length; this.pending = null;
    }
  }
}
