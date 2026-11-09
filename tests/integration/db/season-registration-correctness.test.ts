import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../../../src/db/schema";
import { createCustomTournamentTemplate } from "../../../src/lib/competition/templates";
import { openSeasonRegistrationInTx } from "../../../src/lib/seasons/lifecycle";
import { getSeasonConfirmationVersion } from "../../../src/lib/seasons/confirmation";
import { openSeasonRegistration, publishSeason, updateSeason } from "@/actions/seasons";
import { planSeasonUpdate, seasonUpdatePayloadSchema } from "../../../src/lib/seasons/edit";
import { toCSTDateTimeInput } from "../../../src/lib/utils/date";
import { createLocalPool } from "./harness/database";

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/session")>(),
  requireSuperAdmin: async () => ({ userId: "fixture-admin" }),
}));
vi.mock("next/cache", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/cache")>(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

const CUSTOM_TEMPLATE = createCustomTournamentTemplate();

function seasonValues(
  id: string,
  overrides: Partial<typeof schema.seasons.$inferInsert> = {},
): typeof schema.seasons.$inferInsert {
  return {
    id,
    slug: `issue-638-${id}`,
    name: "Issue 638 correctness fixture",
    kind: "custom",
    competitionTemplate: "custom",
    status: "registration",
    registrationMode: CUSTOM_TEMPLATE.registrationMode,
    hasCaptainVoting: CUSTOM_TEMPLATE.hasCaptainVoting,
    hasDraft: CUSTOM_TEMPLATE.hasDraft,
    hasCommunityAwards: CUSTOM_TEMPLATE.hasCommunityAwards,
    minTeamSize: CUSTOM_TEMPLATE.minTeamSize,
    maxTeamSize: CUSTOM_TEMPLATE.maxTeamSize,
    starterCount: CUSTOM_TEMPLATE.starterCount,
    positions: CUSTOM_TEMPLATE.positions,
    stagePlan: CUSTOM_TEMPLATE.stagePlan,
    registrationConfig: CUSTOM_TEMPLATE.registrationConfig,
    teamRegistrationConfig: CUSTOM_TEMPLATE.teamRegistrationConfig,
    affiliationRules: CUSTOM_TEMPLATE.affiliationRules,
    ...overrides,
  };
}

describe("season registration correctness PostgreSQL", () => {
  it("separates due schedule catch-up, unscheduled immediate open, and early force-open", async () => {
    const pool = createLocalPool();
    const database = drizzle(pool, { schema });
    const seasonIds: string[] = [];
    const planned = new Date("2026-09-08T08:00:00.000Z");
    const transition = new Date("2026-09-08T08:00:03.838Z");
    const future = new Date("2026-09-20T08:00:00.000Z");

    try {
      const dueId = randomUUID();
      seasonIds.push(dueId);
      await database.insert(schema.seasons).values(seasonValues(dueId, { registrationOpensAt: planned }));
      const dueResult = await database.transaction((tx) => openSeasonRegistrationInTx(tx, {
        seasonId: dueId,
        actorId: "issue-638-test",
        now: transition,
        mode: "scheduled",
      }));
      expect(dueResult.opened).toBe(true);
      const dueRow = await database.query.seasons.findFirst({ where: eq(schema.seasons.id, dueId) });
      expect(dueRow).toMatchObject({ registrationOpensAt: planned, registrationOpenedAt: transition });

      const unscheduledId = randomUUID();
      seasonIds.push(unscheduledId);
      const [unscheduled] = await database.insert(schema.seasons).values(seasonValues(unscheduledId)).returning();
      const immediateResult = await database.transaction((tx) => openSeasonRegistrationInTx(tx, {
        seasonId: unscheduledId,
        actorId: "issue-638-test",
        now: transition,
        mode: "explicit_immediate",
        expectedVersion: getSeasonConfirmationVersion(unscheduled),
      }));
      expect(immediateResult.opened).toBe(true);
      const immediateRow = await database.query.seasons.findFirst({ where: eq(schema.seasons.id, unscheduledId) });
      expect(immediateRow).toMatchObject({ registrationOpensAt: transition, registrationOpenedAt: transition });

      const futureId = randomUUID();
      seasonIds.push(futureId);
      const [scheduled] = await database.insert(schema.seasons).values(seasonValues(futureId, { registrationOpensAt: future })).returning();
      await expect(database.transaction((tx) => openSeasonRegistrationInTx(tx, {
        seasonId: futureId,
        actorId: "issue-638-test",
        now: transition,
        mode: "explicit_immediate",
        expectedVersion: getSeasonConfirmationVersion(scheduled),
      }))).rejects.toThrow("如需提前开放");
      const untouchedFuture = await database.query.seasons.findFirst({ where: eq(schema.seasons.id, futureId) });
      expect(untouchedFuture).toMatchObject({ registrationOpensAt: future, registrationOpenedAt: null });

      const earlyResult = await database.transaction((tx) => openSeasonRegistrationInTx(tx, {
        seasonId: futureId,
        actorId: "issue-638-test",
        now: transition,
        mode: "explicit_early_force",
        expectedVersion: getSeasonConfirmationVersion(scheduled),
      }));
      expect(earlyResult.opened).toBe(true);
      const earlyRow = await database.query.seasons.findFirst({ where: eq(schema.seasons.id, futureId) });
      expect(earlyRow).toMatchObject({ registrationOpensAt: transition, registrationOpenedAt: transition });
    } finally {
      await pool.query("DELETE FROM seasons WHERE id = ANY($1::uuid[])", [seasonIds]);
      await pool.end();
    }
  });

  it("rejects saved configuration changes under the publication and manual opening locks", async () => {
    const pool = createLocalPool();
    const database = drizzle(pool, { schema });
    const seasonId = randomUUID();
    const schedule = new Date(Date.now() + 86_400_000);
    const nextSchedule = new Date(schedule.getTime() + 86_400_000);
    const readSeason = () => database.query.seasons.findFirst({ where: eq(schema.seasons.id, seasonId) });
    const readActions = async () => (await pool.query<{ action: string }>(
      "SELECT action FROM audit_logs WHERE season_id=$1 ORDER BY created_at", [seasonId],
    )).rows.map(({ action }) => action);

    try {
      await database.insert(schema.seasons).values(seasonValues(seasonId, {
        name: "Saved draft",
        status: "draft",
        competitionTemplate: "rivals",
        kind: "Rivals",
        registrationOpensAt: schedule,
      }));
      const preview = getSeasonConfirmationVersion((await readSeason())!);
      const writer = await pool.connect();
      try {
        await writer.query("BEGIN");
        await writer.query("UPDATE seasons SET name='Changed draft' WHERE id=$1", [seasonId]);
        const [{ pid }] = (await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows;
        const publishing = publishSeason({ seasonId, expectedVersion: preview });
        await expect.poll(async () => {
          const waiting = await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))", [pid]);
          return waiting.rowCount;
        }, { timeout: 2000, interval: 10 }).toBe(1);
        await writer.query("COMMIT");
        await expect(publishing).resolves.toMatchObject({
          success: false,
          error: { code: "SEASON_CONFIGURATION_CHANGED" },
        });
      } finally {
        await writer.query("ROLLBACK");
        writer.release();
      }
      expect(await readSeason()).toMatchObject({ status: "draft", name: "Changed draft" });
      expect(await readActions()).toEqual([]);

      const savedDraft = (await readSeason())!;
      await expect(publishSeason({
        seasonId,
        expectedVersion: getSeasonConfirmationVersion(savedDraft),
      })).resolves.toMatchObject({ success: true });
      const openPreview = getSeasonConfirmationVersion((await readSeason())!);
      // These changes leave updated_at unchanged to check the saved facts themselves.
      await database.update(schema.seasons).set({ registrationOpensAt: nextSchedule }).where(eq(schema.seasons.id, seasonId));
      await expect(openSeasonRegistration({
        seasonId, expectedVersion: openPreview, mode: "early_force",
      })).resolves.toMatchObject({ success: false, error: { code: "SEASON_CONFIGURATION_CHANGED" } });
      const beforeOpen = (await readSeason())!;
      expect(beforeOpen).toMatchObject({
        status: "registration", registrationOpensAt: nextSchedule, registrationOpenedAt: null,
      });
      expect(await readActions()).toEqual(["season.publish"]);

      await expect(openSeasonRegistration({
        seasonId, expectedVersion: getSeasonConfirmationVersion(beforeOpen), mode: "early_force",
      })).resolves.toMatchObject({ success: true });
      const opened = (await readSeason())!;
      expect(opened.registrationOpenedAt).toBeInstanceOf(Date);
      expect(opened.registrationOpensAt).toEqual(opened.registrationOpenedAt);
      expect(await readActions()).toEqual(["season.publish", "season.registration_open"]);
    } finally {
      await pool.query("DELETE FROM seasons WHERE id=$1", [seasonId]);
      await pool.end();
    }
  });

  it("persists a legal deadline update through a lossy frozen opening replay", async () => {
    const pool = createLocalPool();
    const database = drizzle(pool, { schema });
    const seasonId = randomUUID();
    const planned = new Date("2026-09-08T08:00:00.000Z");
    const opened = new Date("2026-09-08T08:00:03.838Z");
    const currentClose = new Date("2026-09-15T08:00:00.000Z");
    const currentRoster = new Date("2026-10-08T08:00:00.000Z");
    const nextClose = new Date("2026-09-18T08:00:00.000Z");

    try {
      await database.insert(schema.seasons).values(seasonValues(seasonId, {
        registrationOpensAt: opened,
        registrationOpenedAt: opened,
        registrationClosesAt: currentClose,
        rosterChangeClosesAt: currentRoster,
      }));
      const persisted = await database.query.seasons.findFirst({ where: eq(schema.seasons.id, seasonId) });
      if (!persisted) throw new Error("Issue 638 fixture 缺少持久化赛季记录。");

      const parsed = seasonUpdatePayloadSchema.parse({
        id: persisted.id,
        name: persisted.name,
        slug: persisted.slug,
        kind: persisted.kind,
        template: persisted.competitionTemplate,
        themeColor: persisted.themeColor,
        registrationOpensAt: toCSTDateTimeInput(persisted.registrationOpensAt),
        registrationClosesAt: toCSTDateTimeInput(nextClose),
        rosterChangeClosesAt: toCSTDateTimeInput(persisted.rosterChangeClosesAt),
        endAt: toCSTDateTimeInput(persisted.endAt),
        registrationMode: persisted.registrationMode,
        hasCaptainVoting: persisted.hasCaptainVoting,
        hasDraft: persisted.hasDraft,
        hasCommunityAwards: persisted.hasCommunityAwards,
        minTeamSize: persisted.minTeamSize,
        maxTeamSize: persisted.maxTeamSize,
        starterCount: persisted.starterCount,
        positions: persisted.positions,
        stagePlan: persisted.stagePlan,
        registrationConfig: persisted.registrationConfig,
        teamRegistrationConfig: persisted.teamRegistrationConfig,
        affiliationRules: persisted.affiliationRules,
      });
      expect(parsed.registrationOpensAt).toBe("2026-09-08T16:00");

      await expect(updateSeason({ ...parsed, registrationClosesAt: "2026-02-31T20:30" })).resolves.toMatchObject({
        success: false, error: { code: "VALIDATION_FAILED" },
      });
      expect(await database.query.seasons.findFirst({ where: eq(schema.seasons.id, seasonId) })).toMatchObject({
        registrationOpensAt: opened, registrationClosesAt: currentClose, rosterChangeClosesAt: currentRoster,
      });

      const plan = planSeasonUpdate(persisted, parsed);
      expect(plan.set).not.toHaveProperty("registrationOpensAt");
      expect(plan.set.registrationClosesAt).toEqual(nextClose);
      expect(plan.set.rosterChangeClosesAt).toEqual(currentRoster);
      expect(plan.set).not.toHaveProperty("teamRegistrationConfig");
      expect(planSeasonUpdate(persisted, { ...parsed, registrationOpensAt: "invalid" }).set)
        .not.toHaveProperty("registrationOpensAt");

      await database.update(schema.seasons).set(plan.set).where(eq(schema.seasons.id, seasonId));
      const reloaded = await database.query.seasons.findFirst({ where: eq(schema.seasons.id, seasonId) });
      expect(reloaded).toMatchObject({
        registrationOpensAt: opened,
        registrationOpenedAt: opened,
        registrationClosesAt: nextClose,
        rosterChangeClosesAt: currentRoster,
        teamRegistrationConfig: persisted.teamRegistrationConfig,
      });
      expect(planned).not.toEqual(opened);
    } finally {
      await pool.query("DELETE FROM seasons WHERE id = $1", [seasonId]);
      await pool.end();
    }
  });
});
