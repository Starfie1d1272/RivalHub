import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { majorRunPresentationSelection } from "@/lib/major/run-snapshot-query";
import { parseMajorRunPresentation, parseMajorRunSnapshot, resolveMajorStagePlanFromPresentations } from "@/lib/major/run-snapshot";
import { resolvePublicStagePlan } from "@/lib/seasons/public-stage";
import { createLocalPool } from "./harness/database";

const stage = { key: "one", name: "Frozen", type: "swiss", teamCount: 32, matchFormat: "bo1", finalFormat: null };
const base = { version: 4, stagePlan: [stage], rosterRules: { minTeamSize: 5, maxTeamSize: 7, starterCount: 5 }, affiliationRules: [], frozenCompetitiveFacts: [], competitiveProfile: null };
const entrants = Array.from({ length: 32 }, (_, i) => ({ entrantId: randomUUID(), competitionEntryId: randomUUID(), tournamentSeed: i + 1 }));
const v3 = { ...base, version: 3, stage: { ...stage, name: "Legacy name" }, tournamentEntrants: entrants };

it("validates a bounded JSONB envelope against the full frozen parser", async () => {
  const pool = createLocalPool();
  const db = drizzle(pool);
  async function project(value: unknown) {
    const column = sql`${JSON.stringify(value)}::jsonb`;
    const result = await db.execute(sql`select ${majorRunPresentationSelection(column)} as presentation`);
    return result.rows[0]!.presentation;
  }
  const badOverride = { entryId: randomUUID(), rosterRevisionId: randomUUID(), restrictionCode: "x", findingSnapshot: { code: "y", message: "", waivable: true }, reason: "ok", grantedBy: "a", grantedAt: "now" };
  const duplicate = (key: "entrantId" | "competitionEntryId" | "tournamentSeed") => entrants.map((entry, i) => i === 1 ? { ...entry, [key]: entrants[0]![key] } : entry);
  const cases: unknown[] = [base, v3, { ...base, runOptions: {} }, { ...base, runOptions: null },
    null, [], { ...base, version: "4" }, { ...base, stagePlan: [] }, { ...base, stagePlan: [stage, stage] },
    { ...base, rosterRules: { ...base.rosterRules, minTeamSize: 8 } },
    { ...base, qualificationPolicy: { externalStrengthGap: { enabled: true, maxGap: -1 } } },
    { ...base, frozenRestrictionOverrides: [badOverride] }, { ...base, affiliationRules: null },
    { ...base, frozenCompetitiveFacts: null }, Object.fromEntries(Object.entries(base).filter(([k]) => k !== "competitiveProfile")),
    Object.fromEntries(Object.entries(base).filter(([k]) => k !== "affiliationRules")),
    { ...v3, stage: { ...stage, key: "other" } }, ...(["entrantId", "competitionEntryId", "tournamentSeed"] as const).map(key => ({ ...v3, tournamentEntrants: duplicate(key) }))];
  try {
    for (const value of cases) {
      const envelope = await project(value);
      let oracle: ReturnType<typeof parseMajorRunSnapshot> | undefined;
      try { oracle = parseMajorRunSnapshot(value, "one"); } catch { /* invalid oracle */ }
      if (!oracle) expect(() => parseMajorRunPresentation(envelope, "one")).toThrow();
      else expect(parseMajorRunPresentation(envelope, "one")).toEqual({ version: oracle.version, stagePlan: oracle.stagePlan, stage: oracle.stage, hasThirdPlaceMatch: oracle.hasThirdPlaceMatch });
    }
    const small = await project(base);
    const large = { ...base, affiliationRules: ["SECRET_MARKER".repeat(10000)], frozenCompetitiveFacts: ["SECRET_MARKER".repeat(10000)], competitiveProfile: { secret: "SECRET_MARKER".repeat(10000) } };
    const bounded = await project(large);
    expect(JSON.stringify(bounded)).not.toContain("SECRET_MARKER");
    expect(JSON.stringify(bounded).length).toBe(JSON.stringify(small).length);
    const presentation = parseMajorRunPresentation(bounded, "one");
    expect(resolveMajorStagePlanFromPresentations([], [{ stageKey: "one", presentation }])[0]?.name).toBe("Frozen");
    const laterStage = { ...stage, key: "two", name: "Later" };
    const laterSnapshot = { ...base, stagePlan: [stage, laterStage] };
    const later = parseMajorRunPresentation(await project(laterSnapshot), "two");
    const earlyWithNewerName = parseMajorRunPresentation(await project({ ...base, stagePlan: [{ ...stage, name: "Earlier" }, laterStage] }), "one");
    const mutable = [{ ...stage, name: "Mutable", type: "swiss" as const, matchFormat: "bo1" as const, finalFormat: undefined, advanceTiers: [] }];
    const season = { id: "s", competitionTemplate: "major" as const, stagePlan: mutable };
    const runs = [{ stageKey: "two", presentation: later }, { stageKey: "one", presentation: earlyWithNewerName }];
    expect(resolvePublicStagePlan(season, runs)[0]?.name).toBe("Frozen");
    expect(resolvePublicStagePlan({ ...season, stagePlan: [{ ...mutable[0]!, name: "Changed" }] }, runs)[0]?.name).toBe("Frozen");
    expect(resolvePublicStagePlan(season, [])[0]?.name).toBe("Mutable");
    expect(resolvePublicStagePlan({ ...season, competitionTemplate: "custom" }, runs)[0]?.name).toBe("Mutable");
    console.info("MAJOR_PRESENTATION_JSON_BYTES", JSON.stringify({ full: Buffer.byteLength(JSON.stringify(large)), projection: Buffer.byteLength(JSON.stringify(bounded)) }));
  } finally { await pool.end(); }
});
