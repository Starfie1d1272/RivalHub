import "server-only";
import type { matches, majorStageRuns, majorFinalResults, predictionMarkets, predictionMarketOptions, predictionStakes, predictionSettlements, predictionLedger } from "@/db/schema";
import { officialWinner } from "./baseline";
import { resolveMarketOptions, type MarketResolutionFact } from "@/lib/bet/resolution";
import { distributePool } from "@/lib/bet/pool";

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];
type Market = Row<typeof predictionMarkets>;
type Option = Row<typeof predictionMarketOptions>;
type Stake = Row<typeof predictionStakes>;
type Batch = Row<typeof predictionSettlements>;
type Ledger = Row<typeof predictionLedger>;
type Match = Row<typeof matches>;
type Run = Row<typeof majorStageRuns>;
type Final = Row<typeof majorFinalResults>;

export interface LegacyRetirementFacts {
  markets: Market[]; options: Option[]; stakes: Stake[];
  /** Ordered by PostgreSQL created_at, id to preserve sub-millisecond revisions. */
  batches: Batch[]; ledger: Ledger[];
  matches: Match[]; runs: Run[]; finals: Final[];
}

/** Read-only reproduction of the retired resolver's accepted-fact boundary. */
function acceptedFact(market: Market, facts: LegacyRetirementFacts): MarketResolutionFact {
  const official = facts.matches.filter(m => m.seasonId === market.seasonId);
  const match = official.find(m => m.id === market.matchId);
  const voided = !match || match.majorStageRunId !== market.subject.stageRunId ||
    match.entryAId !== market.subject.entryIds[0] || match.entryBId !== market.subject.entryIds[1] || match.status === "cancelled";
  if (voided) return { state: "void", revision: JSON.stringify({ matchId: market.matchId, voided: true }) };
  const winner = officialWinner(match);
  const run = facts.runs.find(r => r.id === match.majorStageRunId);
  const final = facts.finals.find(f => f.seasonId === market.seasonId);
  const accepted = match.round ? !!run && run.finalizedRound >= match.round :
    match.entryRound === "quarterfinal" ? official.some(m => m.majorStageRunId === match.majorStageRunId && m.entryRound === "semifinal") :
    match.entryRound === "semifinal" ? official.some(m => m.majorStageRunId === match.majorStageRunId && m.entryRound === "final") : final?.status === "confirmed";
  return winner && accepted ? { state: "confirmed", winningKeys: [winner], revision: JSON.stringify({ run: run?.id, winner, scoreA: match.scoreA, scoreB: match.scoreB, accepted }) } : { state: "pending", revision: "pending" };
}

/** Reject incomplete or inconsistent history; never writes or calculates an adjustment. */
export function verifyLegacyRetirement(facts: LegacyRetirementFacts) {
  const expectedFinancialLedger = new Set<string>();
  const evidence: Array<{ marketId: string; seasonId: string; batchId: string | null; fingerprint: string | null; factRevision: string | null; reason: string }> = [];
  const fail = (market: Market, reason: string): never => { throw new Error(`legacy market ${market.id}: ${reason}`); };
  for (const market of facts.markets) {
    const stakes = facts.stakes.filter(s => s.marketId === market.id);
    const batches = facts.batches.filter(b => b.marketId === market.id);
    if (!stakes.length) {
      if (batches.some(b => facts.ledger.some(l => l.source === `settlement/${b.id}`))) fail(market, "unstaked market has settlement ledger");
      const last = batches.at(-1);
      evidence.push({ marketId: market.id, seasonId: market.seasonId, batchId: last?.id ?? null, fingerprint: last?.fingerprint ?? null, factRevision: last?.factRevision ?? null, reason: "no stakes" });
      continue;
    }
    if (market.resolver !== "match_winner") fail(market, "unsupported resolver");
    for (const stake of stakes) {
      const source = `stake/${stake.id}`;
      const rows = facts.ledger.filter(l => l.source === source);
      if (rows.length !== 1 || rows[0]!.seasonId !== market.seasonId || rows[0]!.accountId !== stake.accountId || rows[0]!.kind !== "stake" || rows[0]!.amount !== -stake.amount || rows[0]!.profit !== BigInt(0)) fail(market, `invalid debit ${stake.id}`);
      expectedFinancialLedger.add(rows[0]!.id);
    }
    const options = facts.options.filter(o => o.marketId === market.id);
    const fact = acceptedFact(market, facts);
    if (fact.state === "pending") fail(market, "official result not accepted");
    const resolution = resolveMarketOptions(options, fact);
    const total = stakes.reduce((n,s) => n+s.amount, BigInt(0));
    const winningPool = stakes.filter(s => resolution.winningOptionIds.includes(s.optionId)).reduce((n,s) => n+s.amount,BigInt(0));
    const state = resolution.state === "settled" && (winningPool === BigInt(0) || winningPool === total) ? "refunded" : resolution.state;
    const winningOptionIds = state === "settled" ? resolution.winningOptionIds : [];
    const fingerprint = JSON.stringify({ state, winningOptionIds, factRevision: resolution.factRevision });
    const latest = batches.at(-1);
    if (!latest || latest.state === "pending" || latest.fingerprint !== fingerprint || latest.factRevision !== resolution.factRevision || JSON.stringify(latest.winningOptionIds) !== JSON.stringify(winningOptionIds) || latest.state !== state) fail(market, "terminal batch does not match accepted official fact");
    for (let i=0; i<batches.length; i++) {
      const batch = batches[i]!;
      if (batch.fingerprint !== JSON.stringify({ state: batch.state, winningOptionIds: batch.winningOptionIds, factRevision: batch.factRevision })) fail(market, `invalid batch fingerprint ${batch.id}`);
      const winners = batch.winningOptionIds;
      if (batch.state === "settled") {
        const pool = stakes.filter(s => winners.includes(s.optionId)).reduce((n,s) => n+s.amount, BigInt(0));
        if (!winners.length || new Set(winners).size !== winners.length || winners.some(id => !options.some(o => o.id === id)) || pool === BigInt(0) || pool === total) fail(market, `invalid winning pool ${batch.id}`);
      } else if (winners.length || (batch.state === "pending" && batch.factRevision !== "pending")) fail(market, `invalid batch state ${batch.id}`);
      const payouts = batch.state === "pending" ? new Map<string,bigint>() : distributePool(stakes.map(s => ({accountId:s.accountId,optionId:s.optionId,stake:s.amount})), batch.state === "settled" ? batch.winningOptionIds : null);
      const rows = facts.ledger.filter(l => l.source === `settlement/${batch.id}`);
      if (rows.length !== payouts.size) fail(market, `incomplete payout ${batch.id}`);
      for (const [accountId, amount] of payouts) {
        const invested = stakes.filter(s => s.accountId === accountId).reduce((n,s) => n+s.amount,BigInt(0));
        const row = rows.find(l => l.accountId === accountId);
        if (!row || row.seasonId !== market.seasonId || row.kind !== "settlement" || row.amount !== amount || row.profit !== amount-invested) fail(market, `invalid payout ${batch.id}/${accountId}`);
        expectedFinancialLedger.add(row!.id);
      }
      if (i > 0) {
        const previous = batches[i-1]!;
        for (const old of facts.ledger.filter(l => l.source === `settlement/${previous.id}`)) {
          const reversal = facts.ledger.filter(l => l.source === `reversal/${batch.id}/${old.id}`);
          if (reversal.length !== 1 || reversal[0]!.seasonId !== old.seasonId || reversal[0]!.accountId !== old.accountId || reversal[0]!.kind !== "reversal" || reversal[0]!.amount !== -old.amount || reversal[0]!.profit !== -old.profit) fail(market, `invalid reversal ${batch.id}/${old.id}`);
          expectedFinancialLedger.add(reversal[0]!.id);
        }
      }
    }
    for (const accountId of new Set(stakes.map(s=>s.accountId))) if (facts.ledger.filter(l=>l.accountId===accountId).reduce((n,l)=>n+l.amount,BigInt(0))<BigInt(0)) fail(market, `outstanding debt for ${accountId}`);
    evidence.push({ marketId: market.id, seasonId: market.seasonId, batchId: latest!.id, fingerprint: latest!.fingerprint, factRevision: latest!.factRevision, reason: "terminal financial history reconciled" });
  }
  for (const row of facts.ledger) {
    const financial = row.kind === "stake" || row.kind === "settlement" || row.source.startsWith("stake/") || row.source.startsWith("settlement/") || row.source.startsWith("reversal/") || (row.kind === "reversal" && !row.source.startsWith("void/"));
    if (financial && !expectedFinancialLedger.has(row.id)) throw new Error(`unmatched legacy financial ledger ${row.id}`);
    if (row.kind === "reversal" && row.source.startsWith("void/")) {
      const reward = facts.ledger.find(l => `void/${l.id}` === row.source);
      if (!reward || reward.kind !== "participation" || reward.seasonId !== row.seasonId || reward.accountId !== row.accountId || row.amount !== -reward.amount || row.profit !== -reward.profit) throw new Error(`invalid Pick'Em void ledger ${row.id}`);
    }
  }
  return evidence;
}
