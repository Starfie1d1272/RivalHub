import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { createCustomTournamentTemplate } from "../../../src/lib/competition/templates";
import { openSeasonRegistrationInTx } from "../../../src/lib/seasons/lifecycle";
import { planSeasonUpdate, seasonUpdatePayloadSchema } from "../../../src/lib/seasons/edit";
import { toCSTDateTimeInput } from "../../../src/lib/utils/date";
import { createLocalPool } from "./harness/database";

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
      await database.insert(schema.seasons).values(seasonValues(unscheduledId));
      const immediateResult = await database.transaction((tx) => openSeasonRegistrationInTx(tx, {
        seasonId: unscheduledId,
        actorId: "issue-638-test",
        now: transition,
        mode: "explicit_immediate",
      }));
      expect(immediateResult.opened).toBe(true);
      const immediateRow = await database.query.seasons.findFirst({ where: eq(schema.seasons.id, unscheduledId) });
      expect(immediateRow).toMatchObject({ registrationOpensAt: transition, registrationOpenedAt: transition });

      const futureId = randomUUID();
      seasonIds.push(futureId);
      await database.insert(schema.seasons).values(seasonValues(futureId, { registrationOpensAt: future }));
      await expect(database.transaction((tx) => openSeasonRegistrationInTx(tx, {
        seasonId: futureId,
        actorId: "issue-638-test",
        now: transition,
        mode: "explicit_immediate",
      }))).rejects.toThrow("如需提前开放");
      const untouchedFuture = await database.query.seasons.findFirst({ where: eq(schema.seasons.id, futureId) });
      expect(untouchedFuture).toMatchObject({ registrationOpensAt: future, registrationOpenedAt: null });

      const earlyResult = await database.transaction((tx) => openSeasonRegistrationInTx(tx, {
        seasonId: futureId,
        actorId: "issue-638-test",
        now: transition,
        mode: "explicit_early_force",
      }));
      expect(earlyResult.opened).toBe(true);
      const earlyRow = await database.query.seasons.findFirst({ where: eq(schema.seasons.id, futureId) });
      expect(earlyRow).toMatchObject({ registrationOpensAt: transition, registrationOpenedAt: transition });
    } finally {
      await pool.query("DELETE FROM seasons WHERE id = ANY($1::uuid[])", [seasonIds]);
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

      const plan = planSeasonUpdate(persisted, parsed);
      expect(plan.set).not.toHaveProperty("registrationOpensAt");
      expect(plan.set.registrationClosesAt).toEqual(nextClose);
      expect(plan.set.rosterChangeClosesAt).toEqual(currentRoster);
      expect(plan.set).not.toHaveProperty("teamRegistrationConfig");

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
