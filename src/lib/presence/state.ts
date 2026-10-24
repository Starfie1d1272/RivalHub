const ACTIVE_MS = 120_000;
const PERSIST_MS = 300_000;
const MAX_ACCOUNTS = 10_000;
type Entry = { seen: number; persisted: number; pending?: Promise<void> };

/** shortcut: one process owns presence; use shared state before adding application replicas. */
export class PresenceState {
  private readonly accounts = new Map<string, Entry>();

  async touch(userId: string, now: number, persist: () => Promise<void>): Promise<void> {
    let entry = this.accounts.get(userId);
    if (!entry) {
      for (const [id, value] of this.accounts) if (value.seen <= now - PERSIST_MS && !value.pending) this.accounts.delete(id);
      if (this.accounts.size >= MAX_ACCOUNTS) throw new Error("Presence capacity reached");
      entry = { seen: now, persisted: -Infinity };
      this.accounts.set(userId, entry);
    }
    entry.seen = now;
    if (entry.pending) return entry.pending;
    if (entry.persisted > now - PERSIST_MS) return;
    const current = entry;
    current.pending = persist().then(() => { current.persisted = now; }).finally(() => { current.pending = undefined; });
    return current.pending;
  }

  count(now: number): number {
    let count = 0;
    for (const entry of this.accounts.values()) if (entry.seen > now - ACTIVE_MS) count++;
    return count;
  }
}
