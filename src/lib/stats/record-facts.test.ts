import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTournamentPerformanceAnalyticsFromProjections, collectTournamentPerformanceMapProjection } from "@cs2dak/tournament";
import type { RivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { adaptStatsEvidence } from "./evidence-adapter";
import { collectRecordEvents, collectRecordFacts } from "./record-facts";
import { parseStatsQuery, statsHref } from "./view-state";

function fixture() {
  const evidence = JSON.parse(readFileSync("tests/fixtures/demo-evidence/normal-map-v1.json", "utf8")) as RivalHubDemoEvidenceV1;
  const bindings = new Map(evidence.participants.map((p, index) => [p.steamId64, { userId: `player-${index}`, entryId: index < 5 ? evidence.target.entryAId : evidence.target.entryBId }]));
  return { evidence, bindings };
}
describe("Records occurrences", () => {
  it("counts exactly four enemy kills plus one TK as 4K, and separates suicide/C4/knife types", () => {
    const { evidence, bindings } = fixture();
    const killer = evidence.participants[0]!, teammate = evidence.participants[1]!, enemies = evidence.participants.slice(5);
    const base = evidence.sourceFacts.kills[0]!;
    const kill = (victim: string, weapon: string, actor: string | null = killer.steamId64) => ({ ...base, roundSeq: 10, killerSteamId64: actor, victimSteamId64: victim, weapon });
    evidence.sourceFacts.kills = [
      ...enemies.slice(0, 4).map((enemy, i) => kill(enemy.steamId64, ["weapon_knife_butterfly", "taser", "hegrenade", "inferno"][i]!)),
      kill(teammate.steamId64, "ak47"), kill(killer.steamId64, "hegrenade"), kill(enemies[4]!.steamId64, "planted_c4"),
      kill(teammate.steamId64, "world", null),
    ];
    evidence.semanticFacts.playerRounds = evidence.semanticFacts.playerRounds.map(row => ({ ...row, kills: row.steamId64 === killer.steamId64 && row.roundSeq === 10 ? 4 : 0 }));
    const facts = collectRecordEvents(evidence, bindings)!;
    expect(facts.eventCounts).toEqual({ fourKill: 1, ace: 0, knife: 1, zeus: 1, he: 1, fire: 1, rare: 0, teamKill: 1, suicide: 1, world: 2 });
    expect(facts.events.find(event => event.kind === "fourKill")?.weapons).toEqual(["hegrenade", "inferno", "knife_butterfly", "taser"]);
    expect(facts.events.find(event => event.kind === "knife")?.weapon).toBe("knife_butterfly");
    expect(facts.multiKills).toEqual([{ entityId: "player-0", entryId: evidence.target.entryAId, fourKills: 1, aces: 0 }]);
    evidence.semanticFacts.playerRounds.find(row => row.roundSeq === 10 && row.steamId64 === killer.steamId64)!.kills = 5;
    evidence.sourceFacts.kills.push(kill(enemies[4]!.steamId64, "galilar"));
    const ace = collectRecordEvents(evidence, bindings)!;
    expect(ace.eventCounts).toMatchObject({ fourKill: 0, ace: 1 });
  });
  it("retains every multi-kill occurrence while compacting extrema and records HE+fire damage", () => {
    const { evidence, bindings } = fixture();
    const row = evidence.semanticFacts.playerRounds.find(row => row.roundSeq === 14)!;
    row.utility.heDamage = 100; row.utility.fireDamage = 88;
    for (const other of evidence.semanticFacts.playerRounds) if (other !== row) { other.utility.heDamage = 0; other.utility.fireDamage = 0; }
    const performance = buildTournamentPerformanceAnalyticsFromProjections([collectTournamentPerformanceMapProjection(adaptStatsEvidence(evidence, bindings).performance)]);
    const facts = collectRecordFacts(evidence, bindings, performance);
    expect(facts.eventCounts).toMatchObject({ fourKill: 2, ace: 1 });
    expect(facts.events?.filter(event => event.kind === "fourKill")).toHaveLength(2);
    expect(facts.candidates.find(candidate => candidate.kind === "utilityDamage")).toMatchObject({ round: 14, numerator: 188 });
    evidence.contract.semanticProfile = "dak-stable/2";
    expect(collectRecordEvents(evidence, bindings)).toBeUndefined();
  });
  it("restores independent record/event pages and resets event pagination on scope/filter changes", () => {
    const query = parseStatsQuery({ tab: "records", recordPage: "2", eventPage: "3", eventType: "fourKill", eventWeapon: "galilar" }, ["play-in"]);
    expect(statsHref("major", query)).toContain("recordPage=2&eventType=fourKill&eventPage=3&eventWeapon=galilar");
    const event = new URL(statsHref("major", query, { eventPage: 4 }), "https://example.test");
    expect(event.searchParams.get("recordPage")).toBe("2");
    expect(event.searchParams.get("eventPage")).toBe("4");
    const record = new URL(statsHref("major", query, { recordPage: 3 }), "https://example.test");
    expect(record.searchParams.get("eventPage")).toBe("3");
    const filter = new URL(statsHref("major", query, { eventType: "ace" }), "https://example.test");
    expect(filter.searchParams.get("recordPage")).toBe("2");
    expect(filter.searchParams.has("eventPage")).toBe(false);
    expect(filter.searchParams.has("eventWeapon")).toBe(false);
    const scope = new URL(statsHref("major", query, { mapFilter: "de_inferno" }), "https://example.test");
    expect(scope.searchParams.has("eventPage")).toBe(false);
    expect(scope.searchParams.has("recordPage")).toBe(false);
    expect(new URL(statsHref("major", query, { tab: "players" }), "https://example.test").searchParams.has("eventType")).toBe(false);
  });
});
