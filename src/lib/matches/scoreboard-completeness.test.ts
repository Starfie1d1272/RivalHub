import { describe, it, expect } from "vitest";
import { isCompleteScoreboard } from "./scoreboard-completeness";
const participants = Array.from({ length: 10 }, (_, i) => ({ userId: `player-${i}`, perfectName: `P${i}` }));
const context = { matchId: "match", mapId: "map", scoreA: 13, scoreB: 5, participants };
const rows = participants.map(player => ({ ...player, matchId: "match", mapId: "map", kills: 0, deaths: 0, assists: 0, hsPercent: 0, firstKills: 0, multiKills: 0, clutches: 0, adr: 0, ratingPro: 0.01, rws: 0, we: 0 }));
describe("complete basic scoreboard", () => {
  it("accepts legal zeros", () => expect(isCompleteScoreboard(context, rows)).toBe(true));
  it.each(["kills", "deaths", "assists", "hsPercent", "firstKills", "multiKills", "clutches", "adr", "ratingPro", "rws", "we"])("requires %s", field => expect(isCompleteScoreboard(context, rows.map((row, i) => i ? row : { ...row, [field]: null }))).toBe(false));
  it("rejects duplicate, missing, outsider, wrong-map and wrong-match rows", () => {
    expect(isCompleteScoreboard(context, [...rows.slice(1), rows[1]])).toBe(false);
    expect(isCompleteScoreboard(context, rows.slice(1))).toBe(false);
    for (const patch of [{ userId: "outsider" }, { mapId: "other" }, { matchId: "other" }, { perfectName: "" }, { deaths: 19 }, { kills: 0.5 }, { adr: Infinity }, { hsPercent: 101 }]) expect(isCompleteScoreboard(context, rows.map((row, i) => i ? row : { ...row, ...patch }))).toBe(false);
  });
});
