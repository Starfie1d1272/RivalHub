import "server-only";
import { asc, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { matches, majorStageRuns, majorFinalResults, predictionMarkets, predictionMarketOptions, predictionStakes, predictionSettlements, predictionLedger } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { LEGACY_RETIREMENT_SNAPSHOT_SQL } from "./retirement-snapshot";
import { verifyLegacyRetirement } from "./retirement-verification";

/** Offline maintenance only. Caller owns the transaction and has isolated old writers. */
export async function recordLegacyRetirementPreflight(tx: TxDb, input: { actorId: string; reason: string }) {
  const actorId = input.actorId.trim();
  const reason = input.reason.trim();
  if (!actorId || !reason || actorId.length > 200 || reason.length > 1000) throw new Error("Retirement requires an accountable actor and reason");
  await tx.execute(sql`SET LOCAL TIME ZONE 'UTC'`);
  await tx.execute(sql`LOCK TABLE public.matches, public.major_stage_runs, public.major_final_results, public.prediction_markets, public.prediction_market_options, public.prediction_accounts, public.prediction_stakes, public.prediction_settlements, public.prediction_ledger IN SHARE ROW EXCLUSIVE MODE`);
  const facts = {
    markets: await tx.select().from(predictionMarkets),
    options: await tx.select().from(predictionMarketOptions),
    stakes: await tx.select().from(predictionStakes),
    batches: await tx.select().from(predictionSettlements).orderBy(asc(predictionSettlements.createdAt), asc(predictionSettlements.id)),
    ledger: await tx.select().from(predictionLedger),
    matches: await tx.select().from(matches),
    runs: await tx.select().from(majorStageRuns),
    finals: await tx.select().from(majorFinalResults),
  };
  const markets = verifyLegacyRetirement(facts);
  const result = await tx.execute<{ digest: string }>(sql.raw(`SELECT ${LEGACY_RETIREMENT_SNAPSHOT_SQL} AS digest`));
  const snapshotDigest = result.rows[0]?.digest;
  if (!snapshotDigest) throw new Error("Retirement snapshot digest unavailable");
  await writeAuditInTx(tx, { action: "predictions.retire_finance", actorId, targetId: snapshotDigest,
    meta: { version: "1", snapshotDigest, reason, markets } });
  return { snapshotDigest, marketCount: markets.length };
}
