import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ userId: "", send: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAuth: async () => ({ userId: state.userId }) }));
vi.mock("@/lib/auth/supabase-server", () => ({ createPublicAuthClient: () => ({ auth: { signInWithOtp: state.send } }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { requestSecondaryEmailIdentity } from "@/actions/identity";

it("serializes concurrent requests and preserves an unknown provider request until DB expiry", async () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  state.userId = randomUUID();
  await db.insert(schema.users).values({ id: state.userId, email: `${state.userId}@local.test` });
  const email = `secondary-${state.userId}@local.test`;
  state.send.mockResolvedValue({ error: { status: 503 } });
  const results = await Promise.all([requestSecondaryEmailIdentity(email), requestSecondaryEmailIdentity(email)]);
  expect(results.every(result => !result.success)).toBe(true);
  expect(state.send).toHaveBeenCalledOnce();
  const read = () => db.select().from(schema.identityLinkRequests).where(eq(schema.identityLinkRequests.userId, state.userId));
  const original = await read();
  expect(original).toHaveLength(1);
  expect(original[0]).toMatchObject({ status: "pending", completedAt: null });
  expect(await requestSecondaryEmailIdentity(email)).toMatchObject({ success: false, error: { meta: { outcome: "unknown" } } });
  expect(await read()).toEqual(original);
  expect(state.send).toHaveBeenCalledOnce();
  // The existing lifetime is the durable cooldown; no client clock bypass.
  await db.update(schema.identityLinkRequests).set({ expiresAt: sql`clock_timestamp() - interval '1 second'` }).where(eq(schema.identityLinkRequests.id, original[0]!.id));
  state.send.mockResolvedValue({ error: null });
  expect(await requestSecondaryEmailIdentity(email)).toEqual({ success: true, data: undefined });
  expect(state.send).toHaveBeenCalledTimes(2);
  const replaced = await read();
  expect(replaced.find(row => row.id === original[0]!.id)?.status).toBe("cancelled");
  expect(replaced.filter(row => row.status === "pending")).toHaveLength(1);
});
