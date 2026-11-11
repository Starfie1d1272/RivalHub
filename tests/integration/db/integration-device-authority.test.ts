import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { revokeUserAdminRole } from "@/actions/admin";
import type { DB } from "@/db/client";
import * as schema from "@/db/schema";
import type { CurrentUserAuthorization } from "@/lib/auth/session";
import {
  authenticateDakRequest, authorizeDakPairing, pollDakPairing,
  requireCurrentDakPairingInTx, startDakPairing,
} from "@/lib/demo-integration/pairing";
import {
  authenticateMizar, authorizeMizarPairing, pollMizarPairing, startMizarPairing,
} from "@/lib/mizar/installation";
import { createLocalPool } from "./harness/database";

const mocks = vi.hoisted(() => ({ db: null as DB | null, superAdmin: vi.fn() }));
vi.mock("@/db/client", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/auth/session", async (original) => ({
  ...await original<typeof import("@/lib/auth/session")>(),
  requireSuperAdmin: mocks.superAdmin,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn() }));

const origin = "https://fixture.example";
let pool: ReturnType<typeof createLocalPool>;
let database: DB;

beforeEach(() => {
  pool = createLocalPool();
  database = drizzle(pool, { schema });
  mocks.db = database;
  vi.stubEnv("ADMIN_SESSION_SECRET", "a".repeat(32));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  mocks.db = null;
  await pool.end();
});

async function addAdmin(): Promise<CurrentUserAuthorization> {
  const userId = randomUUID();
  const email = `${userId}@local.test`;
  await database.insert(schema.users).values({ id: userId, email, role: "super_admin" });
  return { userId, email, role: "super_admin", seasonIds: [] };
}

async function addSeason() {
  const id = randomUUID();
  await database.insert(schema.seasons).values({ id, slug: id, name: "Pairing", kind: "custom" });
  return id;
}

function dakRequest(token: string) {
  return new Request(origin, { headers: { authorization: `Bearer ${token}` } });
}

it("revokes the original wildcard DAK token with its admin while the event-owned Mizar device remains authorized", async () => {
  const [owner, operator, seasonId] = await Promise.all([addAdmin(), addAdmin(), addSeason()]);
  mocks.superAdmin.mockResolvedValue(owner);
  const [dak, mizar] = await Promise.all([startDakPairing(origin), startMizarPairing(origin)]);
  await authorizeDakPairing(dak.pairingId, operator);
  await authorizeMizarPairing(mizar.pairingId, seasonId, operator);
  const [dakPoll, mizarPoll] = await Promise.all([
    pollDakPairing(dak.pairingId, dak.pollToken), pollMizarPairing(mizar.pairingId, mizar.pollToken),
  ]);
  if (dakPoll.status !== "authorized" || mizarPoll.status !== "authorized") throw new Error("Pairing setup failed");
  const request = dakRequest(dakPoll.accessToken);
  const { pairing } = await authenticateDakRequest(request, "event:read");
  expect(pairing.seasonIds).toEqual(["*"]);

  expect(await revokeUserAdminRole(operator.userId)).toMatchObject({ success: true });
  await expect(authenticateDakRequest(request, "event:read")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(database.transaction((tx) => requireCurrentDakPairingInTx(tx, pairing.id)))
    .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(await authenticateMizar(`Bearer ${mizarPoll.credential}`)).toMatchObject({ competitionId: seasonId });
});
