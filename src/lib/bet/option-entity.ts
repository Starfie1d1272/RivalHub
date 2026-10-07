import type { BetOptionEntity, BetSubject, MarketType } from "./types";
/** Only options backed by the frozen subject have a public entity destination. */
export function betOptionEntity(type: MarketType, subject: BetSubject, key: string): BetOptionEntity {
  if (type === "top_fragger" && subject.kind === "event" && subject.playerIds.includes(key)) return { kind: "player", userId: key };
  if (["champion", "match_winner", "map_winner"].includes(type) && subject.entryIds.includes(key)) return { kind: "team", entryId: key };
  return null;
}
