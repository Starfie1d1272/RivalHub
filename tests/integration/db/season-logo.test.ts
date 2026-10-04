import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
import { db } from "../../../src/db/client";
import { auditLogs, matches, seasons, users } from "../../../src/db/schema";
import { replaceSeasonLogoInTx } from "../../../src/lib/season-public-info/commands";
import { getSeasonPublicInfoAdmin } from "../../../src/lib/season-public-info/read-model";
import { getPublicSeasonBySlug } from "../../../src/lib/data/public-seasons";
import { loadMizarMatchDocument, loadMizarScheduleWindow } from "../../../src/lib/mizar/context";
import { createCompetitionTemplate } from "../../../src/lib/competition/templates";
import { seedFixture } from "./harness/mizar";

// Disposable worker DB owns committed fixtures, as in the existing Mizar suite.
describe("canonical event logo and provider freshness", () => {
  it("keeps historical null readable and changes only branding revisions on upload/replacement/removal", async () => {
    const f = await seedFixture();
    const actorId = randomUUID();
    await db.insert(users).values({ id: actorId, email: `${actorId}@local.test`, role: "super_admin" });
    const ctx = { role: "season_admin" as const, actorId, seasonIds: [f.seasonId] };
    const read = async () => ({
      match: await loadMizarMatchDocument(f.matchId, f.seasonId),
      schedule: await loadMizarScheduleWindow(f.seasonId, new Date("2026-09-27"), new Date("2026-10-01")),
      public: await getPublicSeasonBySlug(f.seasonId),
    });
    await db.insert(seasons).values({ slug: randomUUID(), name: "A different event", kind: "custom", status: "archived", stagePlan: [], registrationConfig: createCompetitionTemplate("custom").registrationConfig });
    expect((await getSeasonPublicInfoAdmin(f.seasonId, "super_admin", []))?.season.id).toBe(f.seasonId);
    const beforeMatch = await db.select().from(matches).where(eq(matches.id, f.matchId));
    const before = await read();
    expect(before.match.match.competition.logoUrl).toBeNull();
    expect(before.schedule.competition.logoUrl).toBeNull();
    expect(before.public?.logoUrl).toBeNull();
    expect(await read()).toEqual(before);
    await expect(db.transaction(tx => replaceSeasonLogoInTx(tx, { ...ctx, seasonIds: [] }, f.seasonId, "https://example.com/denied.png"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await read()).toEqual(before);
    let previous = before;
    for (const logoUrl of ["https://example.supabase.co/storage/v1/object/public/season-public-assets/event/logo-a.png", "https://example.supabase.co/storage/v1/object/public/season-public-assets/event/logo-b.png", null]) {
      const updated = await db.transaction(tx => replaceSeasonLogoInTx(tx, ctx, f.seasonId, logoUrl));
      expect(updated.oldLogoUrl).toBe(previous.match.match.competition.logoUrl);
      const next = await read();
      expect(next.match.match.competition.logoUrl).toBe(logoUrl);
      expect(next.schedule.competition.logoUrl).toBe(logoUrl);
      expect(next.public?.logoUrl).toBe(logoUrl);
      expect(next.match.revision).not.toBe(previous.match.revision);
      expect(next.schedule.revision).not.toBe(previous.schedule.revision);
      expect(await read()).toEqual(next);
      previous = next;
    }
    expect(previous).toEqual(before); // updatedAt does not perturb document hashes.
    expect(await db.select().from(matches).where(eq(matches.id, f.matchId))).toEqual(beforeMatch);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.seasonId, f.seasonId));
    expect(audit.filter(row => row.action === "season.update")).toHaveLength(3);
    expect((await db.select().from(seasons).where(eq(seasons.id, f.seasonId)))[0]?.logoUrl).toBeNull();
  });
});
