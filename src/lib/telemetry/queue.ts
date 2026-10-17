import { LIMITS, type Bootstrap, type TelemetryEvent } from "./protocol";

type Batch = { id: string; ticket: string; events: TelemetryEvent[]; attempts: number };
/** Lossy, memory-only, bounded delivery. Retrying keeps the same batch ID. */
export class TelemetryQueue {
  private events: TelemetryEvent[] = [];
  private pending: Batch | null = null;
  private busy = false;
  private nextAttempt = 0;
  readonly metrics = { events: 0, dropped: 0, requests: 0, bytes: 0, failures: 0 };
  constructor(private config: Bootstrap, private readonly send: typeof fetch = fetch) {}
  configure(config: Bootstrap) { this.config = config; }

  add(event: TelemetryEvent) {
    if (Date.now() >= this.config.expiresAt) return;
    this.metrics.events++;
    if (this.events.length >= LIMITS.queue) { this.events.shift(); this.metrics.dropped++; }
    this.events.push(event);
    // Collection never sends synchronously and never creates one request per click.
  }

  async flush() {
    const now = Date.now();
    if (this.busy || now < this.nextAttempt || now >= this.config.expiresAt) return;
    this.events = this.events.filter(event => event.at > now - LIMITS.ageMs);
    if (this.pending && this.pending.events[0].at <= now - LIMITS.ageMs) this.pending = null;
    if (!this.pending && this.events.length) {
      const differentSession = this.events.findIndex(e => e.session !== this.events[0].session);
      const count = Math.min(LIMITS.batch, differentSession < 0 ? LIMITS.batch : differentSession);
      this.pending = { id: crypto.randomUUID(), ticket: this.config.ticket, events: this.events.splice(0, count), attempts: 0 };
    }
    if (!this.pending) return;
    const batch = this.pending;
    const body = JSON.stringify({ v: 1, ticket: batch.ticket, id: batch.id, events: batch.events });
    const bytes = new TextEncoder().encode(body).byteLength;
    if (bytes > LIMITS.bytes) { this.metrics.dropped += batch.events.length; this.pending = null; return; }
    this.busy = true;
    batch.attempts++;
    this.metrics.requests++;
    this.metrics.bytes += bytes;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.send(this.config.endpoint, {
        method: "POST", body, headers: { "Content-Type": "text/plain" },
        credentials: "omit", referrerPolicy: "no-referrer", keepalive: true, signal: controller.signal,
      });
      if (!response.ok) throw new Error("delivery_failed");
      this.pending = null;
      this.nextAttempt = now + 1000;
    } catch {
      this.metrics.failures++;
      this.nextAttempt = now + LIMITS.flushMs * 2 ** (batch.attempts - 1);
      if (batch.attempts >= 3) { this.metrics.dropped += batch.events.length; this.pending = null; }
    } finally { clearTimeout(timeout); this.busy = false; }
  }
}
