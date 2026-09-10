import { z } from "zod";
import {
  generateMajorPlayoffNextRound,
  type MajorPlayoffMatchFact,
} from "@/lib/major/playoff";
import type { Pick, PredictionRules } from "./types";
export const rulesSchema = z
  .object({
    perfect: z.number().int().min(0).max(2),
    advance: z.number().int().min(1).max(6),
    eliminated: z.number().int().min(0).max(2),
    swissTarget: z.number().int().min(1).max(12),
    silver: z.number().int().min(1).max(10),
    gold: z.number().int().min(1).max(10),
    diamond: z.number().int().min(1).max(10),
    initialPoints: z.number().int().min(1).max(100000),
    stagePoints: z.number().int().min(0).max(100000),
    participationPoints: z.number().int().min(0).max(10000),
    cutoffMinutes: z.number().int().min(0).max(1440),
  })
  .refine(
    (r) =>
      r.perfect + r.advance <= 8 &&
      r.swissTarget <= r.perfect + r.advance + r.eliminated &&
      r.silver < r.gold &&
      r.gold < r.diamond,
    "槽位数量或挑战门槛不合法",
  );
export const DEFAULT_RULES: PredictionRules = {
  perfect: 2,
  advance: 6,
  eliminated: 2,
  swissTarget: 5,
  silver: 5,
  gold: 7,
  diamond: 10,
  initialPoints: 1000,
  stagePoints: 300,
  participationPoints: 0,
  cutoffMinutes: 5,
};
export const pickSchema = z.union([
  z.object({
    perfect: z.array(z.union([z.guid(), z.literal("")])).max(2),
    advance: z.array(z.union([z.guid(), z.literal("")])).max(8),
    eliminated: z.array(z.union([z.guid(), z.literal("")])).max(2),
  }),
  z.object({ bracket: z.array(z.string().max(36)).max(7) }),
]);
export function validatePick(
  pick: Pick,
  entrants: readonly { teamId: string; seed: number }[],
  kind: "swiss" | "single_elim",
  rules: PredictionRules,
): void {
  if (kind === "swiss") {
    if (
      !("perfect" in pick) ||
      pick.perfect.length !== rules.perfect ||
      pick.advance.length !== rules.advance ||
      pick.eliminated.length !== rules.eliminated
    )
      throw new Error("请填满全部槽位");
    const ids = [...pick.perfect, ...pick.advance, ...pick.eliminated];
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => !entrants.some((e) => e.teamId === id))
    )
      throw new Error("队伍重复或不属于本阶段官方名单");
    return;
  }
  if (!("bracket" in pick) || pick.bracket.length !== 7)
    throw new Error("请填写全部七个淘汰赛胜者");
  const facts: MajorPlayoffMatchFact[] = [];
  for (let i = 0; i < 7; ) {
    const pairs = generateMajorPlayoffNextRound({
      entrants: entrants.map((e) => ({
        teamId: e.teamId,
        playoffSeed: e.seed,
      })),
      matches: facts,
    });
    for (const p of pairs) {
      const winnerId = pick.bracket[i++]!;
      if (![p.higherSeedTeamId, p.lowerSeedTeamId].includes(winnerId))
        throw new Error("下游胜者必须来自自己的上游选择");
      facts.push({
        matchId: `${p.round}:${p.slot}`,
        round: p.round,
        slot: p.slot,
        entryAId: p.higherSeedTeamId,
        entryBId: p.lowerSeedTeamId,
        winnerId,
      });
    }
  }
}
export function judgePick(
  pick: Pick,
  actual: Pick,
): { hits: number; challenges: boolean[] } {
  if ("perfect" in pick && "perfect" in actual) {
    const hits = (Object.keys(pick) as (keyof typeof pick)[]).reduce(
      (n, k) => n + pick[k].filter((id) => actual[k].includes(id)).length,
      0,
    );
    return { hits, challenges: [] };
  }
  if ("bracket" in pick && "bracket" in actual) {
    // Each slot is judged independently; champion does not depend on the predicted opponent.
    const hit = pick.bracket.map((id, i) => id === actual.bracket[i]);
    return {
      hits: hit.filter(Boolean).length,
      challenges: [
        hit.slice(0, 4).filter(Boolean).length >= 2,
        hit.slice(4, 6).some(Boolean),
        hit[6] === true,
      ],
    };
  }
  throw new Error("Pick kind mismatch");
}
export function coinLevel(
  locked: number,
  challenges: number,
  r: PredictionRules,
): string {
  return challenges >= r.diamond
    ? "钻石"
    : challenges >= r.gold
      ? "黄金"
      : challenges >= r.silver
        ? "白银"
        : locked > 0
          ? "青铜"
          : "未获得";
}
export interface PoolPosition {
  accountId: string;
  side: string;
  stake: bigint;
}
/** Integer, no-rake pari-mutuel settlement. Stable largest remainder per account. */
export function distributePool(
  positions: readonly PoolPosition[],
  winner: string | null,
): Map<string, bigint> {
  const aggregate = new Map<string, PoolPosition>();
  for (const p of positions) {
    if (p.stake <= BigInt(0)) throw new Error("Stake must be positive");
    const prev = aggregate.get(p.accountId);
    if (prev && prev.side !== p.side) throw new Error("Cannot bet both sides");
    aggregate.set(p.accountId, {
      ...p,
      stake: p.stake + (prev?.stake ?? BigInt(0)),
    });
  }
  const rows = [...aggregate.values()];
  const total = rows.reduce((n, p) => n + p.stake, BigInt(0));
  const winners = rows.filter((p) => p.side === winner);
  const winningPool = winners.reduce((n, p) => n + p.stake, BigInt(0));
  if (!winner || winningPool === BigInt(0) || winningPool === total)
    return new Map(rows.map((p) => [p.accountId, p.stake]));
  const losingPool = total - winningPool;
  const parts = winners.map((p) => ({
    ...p,
    payout: p.stake + (p.stake * losingPool) / winningPool,
    remainder: (p.stake * losingPool) % winningPool,
  }));
  parts.sort((a, b) =>
    a.remainder === b.remainder
      ? a.accountId < b.accountId
        ? -1
        : 1
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  let remainder = total - parts.reduce((n, p) => n + p.payout, BigInt(0));
  for (const p of parts)
    if (remainder > BigInt(0)) {
      p.payout++;
      remainder--;
    }
  return new Map(
    rows.map((p) => [
      p.accountId,
      parts.find((w) => w.accountId === p.accountId)?.payout ?? BigInt(0),
    ]),
  );
}
