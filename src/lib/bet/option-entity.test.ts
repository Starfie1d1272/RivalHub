import { describe, expect, it } from "vitest";
import { betOptionEntity } from "./option-entity";
import { MARKET_TYPES, type BetSubject } from "./types";
const event: BetSubject = { kind: "event", entryIds: ["entry-a"], playerIds: ["user-a"] };
const match: BetSubject = { kind: "match", entryIds: ["entry-a", "entry-b"], runId: "run", format: "bo3", mapPool: [] };
const map: BetSubject = { ...match, kind: "map", mapId: "map", mapOrder: 1, mapName: "de_inferno" };
describe("BET public option identity", () => {
  it("preserves entity keys for champion, top fragger and match/map winners", () => {
    expect(betOptionEntity("champion", event, "entry-a")).toEqual({ kind: "team", entryId: "entry-a" });
    expect(betOptionEntity("top_fragger", event, "user-a")).toEqual({ kind: "player", userId: "user-a" });
    expect(betOptionEntity("match_winner", match, "entry-b")).toEqual({ kind: "team", entryId: "entry-b" });
    expect(betOptionEntity("map_winner", map, "entry-a")).toEqual({ kind: "team", entryId: "entry-a" });
  });
  it("keeps non-entity and unknown/frozen-subject-mismatched options as text", () => {
    for (const type of MARKET_TYPES) expect(betOptionEntity(type, event, "unrelated")).toBeNull();
    for (const type of ["exact_score", "total_maps", "veto_map", "total_rounds"] as const) expect(betOptionEntity(type, match, "entry-a")).toBeNull();
    expect(betOptionEntity("top_fragger", match, "entry-a")).toBeNull();
  });
});
