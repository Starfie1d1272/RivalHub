import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, it, vi } from "vitest";
import type { DB } from "@/db/client";
import * as schema from "@/db/schema";
import { createLocalPool } from "./harness/database";
import { PresenceState } from "@/lib/presence/state";

const owner = vi.hoisted(() => ({ current: undefined as DB | undefined }));
vi.mock("@/db/client", () => ({ get db() { return owner.current!; } }));
import { heartbeatPresence } from "@/lib/presence/server";

// Execute the real production query: a mock cannot prove ON CONFLICT's
// no-update/RETURNING semantics or concurrent checkpoint preservation.
it("keeps persistent activity throttled across concurrency and process restarts", async () => {
  const pool = createLocalPool();
  owner.current = drizzle(pool, { schema });
  const userId = randomUUID();
  const runtime = globalThis as typeof globalThis & { rivalhubPresence?: PresenceState };
  const previous = runtime.rivalhubPresence;
  let now = Date.now();
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  const savedMode = process.env.RIVALHUB_PRESENCE_MODE;
  const readTime = async () => Number((await pool.query("SELECT extract(epoch FROM last_active_at) * 1000 AS at FROM user_sessions WHERE user_id=$1", [userId])).rows[0].at);
  try {
    await pool.query("INSERT INTO users(id,email,display_name,role) VALUES($1,$2,'Presence fixture','user')", [userId, `${userId}@local.test`]);
    process.env.RIVALHUB_PRESENCE_MODE = "single-process";
    runtime.rivalhubPresence = new PresenceState();
    const initial = now;
    await Promise.all([heartbeatPresence(userId), heartbeatPresence(userId)]);
    expect(await readTime()).toBe(initial);
    expect(await heartbeatPresence(null)).toEqual({ count: 1, windowSeconds: 120, intervalMs: 60000 });
    now += 60000;
    runtime.rivalhubPresence = new PresenceState();
    await heartbeatPresence(userId);
    expect(await readTime()).toBe(initial);
    now = initial + 300000;
    await heartbeatPresence(userId);
    expect(await readTime()).toBe(now);
    now += 120000;
    expect((await heartbeatPresence(null)).count).toBe(0);
    process.env.RIVALHUB_PRESENCE_MODE = "database";
    await Promise.all([heartbeatPresence(userId), heartbeatPresence(userId)]);
    expect(await readTime()).toBe(initial + 300000);
    expect(await heartbeatPresence(null)).toMatchObject({ windowSeconds: 300, intervalMs: 300000 });
  } finally {
    clock.mockRestore();
    if (savedMode === undefined) delete process.env.RIVALHUB_PRESENCE_MODE;
    else process.env.RIVALHUB_PRESENCE_MODE = savedMode;
    runtime.rivalhubPresence = previous;
    await pool.query("DELETE FROM user_sessions WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
    await pool.end();
  }
});
