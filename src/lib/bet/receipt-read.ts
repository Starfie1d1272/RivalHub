import "server-only";
import {and,eq} from "drizzle-orm";
import type {TxDb} from "@/db/client";
import {betAccounts,betStakes} from "@/db/schema";
import {AppError,ErrorCode} from "@/lib/errors";

/** A missing receipt cannot prove rollback while an earlier request is in flight. */
export async function readBetStakeReceipt(tx:Pick<TxDb,"select">,input:{seasonId:string;userId:string;requestId:string;marketId:string;optionId:string;amount:string}) {
  const [receipt]=await tx.select({stake:betStakes}).from(betStakes)
    .innerJoin(betAccounts,eq(betAccounts.id,betStakes.accountId))
    .where(and(eq(betAccounts.userId,input.userId),eq(betAccounts.seasonId,input.seasonId),eq(betStakes.requestId,input.requestId)));
  if(!receipt)return {status:"unconfirmed" as const};
  const stake=receipt.stake;
  if(stake.marketId!==input.marketId||stake.optionId!==input.optionId||stake.allIn!==(input.amount==="all")||!stake.allIn&&stake.amount.toString()!==input.amount)
    throw new AppError(ErrorCode.VALIDATION_FAILED,"请求标识与投入内容不一致");
  return {status:"committed" as const,amount:stake.amount.toString()};
}
