import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewRegistration } from "@/actions/admin";
import { submitRegistration } from "@/actions/register";
import type { DB } from "@/db/client";
import * as schema from "@/db/schema";
import { normalizeRegistrationConfig } from "@/lib/seasons/compatibility";
import type { RegistrationFormData } from "@/lib/validators/registration";
import { createLocalPool, testSteam64 } from "./harness/database";

const dependencies = vi.hoisted(() => ({
  database: null as DB | null,
  session: vi.fn(),
  admin: vi.fn(),
  steam: vi.fn(),
}));

vi.mock("@/db/client", () => ({ get db() { return dependencies.database; } }));
vi.mock("@/lib/auth/session", async (original) => ({
  ...await original<typeof import("@/lib/auth/session")>(),
  getUserSession: dependencies.session,
  requireSeasonAdmin: dependencies.admin,
}));
vi.mock("@/lib/steam-profiles", async (original) => ({
  ...await original<typeof import("@/lib/steam-profiles")>(),
  getSteamProfileForPrimary: dependencies.steam,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn() }));

const mapPool = ["de_mirage", "de_nuke", "de_inferno"];
const position = "anchor";
const secondary = "entry";

let pool: ReturnType<typeof createLocalPool>;
let database: DB;

beforeEach(() => {
  vi.resetAllMocks();
  pool = createLocalPool();
  database = drizzle(pool, { schema });
  dependencies.database = database;
});

afterEach(async () => {
  dependencies.database = null;
  await pool.end();
});

async function fixture() {
  const seasonId = randomUUID();
  const now = Date.now();
  await database.insert(schema.seasons).values({
    id: seasonId, slug: seasonId, name: "Solo write fence", kind: "Rivals",
    registrationMode: "solo", status: "registration", hasCaptainVoting: true,
    registrationOpensAt: new Date(now - 60_000), registrationOpenedAt: new Date(now - 60_000),
    registrationClosesAt: new Date(now + 60_000), positions: [position, secondary],
    registrationConfig: normalizeRegistrationConfig({ maxPerPosition: 1, maxTotal: 3, mapPool }),
  });
  return seasonId;
}

async function player(seasonId: string) {
  const id = randomUUID();
  const email = `${id}@local.test`;
  const steam64 = testSteam64(id);
  await database.insert(schema.users).values({ id, email, steam64 });
  const form: RegistrationFormData = {
    seasonId, email, steam64, playerType: "enrolled", studentId: "fixture",
    qq: "12345678", perfectName: id, primaryPosition: position, secondaryPosition: secondary,
    peakRank: "A+", peakRankSeason: "S1", peakRating: 1.10, currentSeasonPeakRank: "A",
    currentRating: 1.10, screenshotUrls: [],
    mapPreferences: mapPool.map((map) => ({ map, level: "strong" })),
    gameplayStyle: "Fixture", willingToBeCaptain: false, antiCheatPledge: true,
  };
  return { session: { userId: id, email }, form };
}

function steamProfile(_database: unknown, _previous: string | null, steam64: string) {
  return { steam64, personaName: "Fixture", profileUrl: `https://steamcommunity.com/profiles/${steam64}`, avatarUrl: null };
}

function pauseSteamLookups(count: number) {
  const firstReached = Promise.withResolvers<void>();
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let started = 0;
  dependencies.steam.mockImplementation(async (...args: Parameters<typeof steamProfile>) => {
    started++;
    if (started === 1) firstReached.resolve();
    if (started === count) reached.resolve();
    await release.promise;
    return steamProfile(...args);
  });
  return { firstReached: firstReached.promise, reached: reached.promise, release: release.resolve };
}

describe("solo registration writes use current season and approval facts", () => {
  it("keeps the approval committed while resubmission is waiting on Steam", async () => {
    const seasonId = await fixture();
    const entrant = await player(seasonId);
    dependencies.session.mockResolvedValue(entrant.session);
    dependencies.steam.mockImplementation(steamProfile);
    const first = await submitRegistration(entrant.form);
    if (!first.success) throw new Error(first.error.message);
    dependencies.admin.mockResolvedValue(entrant.session);
    const pause = pauseSteamLookups(1);
    const resubmission = submitRegistration(entrant.form);
    try {
      await Promise.race([pause.reached, resubmission.then(() => { throw new Error("Resubmission finished before lookup"); })]);
      expect(await reviewRegistration({ registrationId: first.data.registrationId, status: "approved" }))
        .toMatchObject({ success: true });
    } finally {
      pause.release();
      await resubmission;
    }
    expect(await resubmission).toMatchObject({ success: false, error: { code: "REGISTRATION_DUPLICATE" } });
    expect(await database.query.seasonRegistrations.findFirst({
      where: eq(schema.seasonRegistrations.id, first.data.registrationId),
    })).toMatchObject({ status: "approved" });
  });

  it("admits one contender for the last position", async () => {
    const seasonId = await fixture();
    const [first, second] = await Promise.all([player(seasonId), player(seasonId)]);
    dependencies.session.mockResolvedValueOnce(first.session).mockResolvedValueOnce(second.session);
    const pause = pauseSteamLookups(2);
    const firstAttempt = submitRegistration(first.form);
    const attempts = [firstAttempt];
    try {
      await Promise.race([pause.firstReached, firstAttempt.then((result) => {
        throw new Error(`First contender finished before lookup: ${JSON.stringify(result)}`);
      })]);
      attempts.push(submitRegistration(second.form));
      await Promise.race([pause.reached, ...attempts.map((attempt) => attempt.then((result) => {
        throw new Error(`Contender finished before both lookups: ${JSON.stringify(result)}`);
      }))]);
    } finally {
      pause.release();
      await Promise.all(attempts);
    }
    const results = await Promise.all(attempts);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.find((result) => !result.success)).toMatchObject({ error: { code: "POSITION_FULL" } });
    expect(await database.query.seasonRegistrations.findMany({
      where: eq(schema.seasonRegistrations.seasonId, seasonId),
    })).toHaveLength(1);
  });

});
