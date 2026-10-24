import "server-only";
import { sql } from "drizzle-orm";
import type { DB, TxDb } from "@/db/client";
import { AppError, ErrorCode } from "@/lib/errors";
import type { ScoreboardCommand, ScoreboardOperation, ScoreboardReceipt } from "./scoreboard-contract";

type ReceiptRow = Omit<ScoreboardReceipt, "createdAt"> & { actorUserId: string; createdAt: Date | string };
export class ScoreboardConflict extends AppError {
  constructor(message = "计分板已被其他操作更新，请先读取当前数据核对，再重新编辑。") {
    super(ErrorCode.VALIDATION_FAILED, message);
  }
}
/** Fresh request authorization must agree with the snapshot/locator owner. */
export function assertScoreboardActor(expectedActor: string, actualActor: string): void {
  if (expectedActor !== actualActor) throw new AppError(ErrorCode.FORBIDDEN, "登录身份已变化，请重新读取计分板后再操作。");
}
/** Internal table contract coordinated by W03; no raw input/image persistence. */
export async function findScoreboardReceipt(executor: DB | TxDb, actorUserId: string, operationId: string): Promise<ReceiptRow | null> {
  const result = await executor.execute<ReceiptRow>(sql`select actor_user_id as "actorUserId", operation_id as "operationId", map_id as "mapId",
    operation, payload_digest as "payloadDigest", base_version as "baseVersion", result_version as "resultVersion", result_count as "resultCount", created_at as "createdAt"
    from public.operator_scoreboard_receipts where actor_user_id = ${actorUserId}::uuid and operation_id = ${operationId}::uuid`);
  return result.rows[0] ?? null;
}
export function assertScoreboardReplay(receipt: Pick<ScoreboardReceipt, "mapId" | "operation" | "payloadDigest">, mapId: string, operation: ScoreboardOperation, digest: string): void {
  if (receipt.mapId !== mapId || receipt.operation !== operation || receipt.payloadDigest !== digest) {
    throw new ScoreboardConflict("同一操作编号已用于不同的计分板请求，请核对原操作，不要重用编号覆盖数据。");
  }
}
export function assertScoreboardVersion(actual: string, expected: string): void {
  if (actual !== expected) throw new ScoreboardConflict();
}
export function presentScoreboardReceipt(receipt: ReceiptRow): ScoreboardReceipt {
  return { operationId: receipt.operationId, mapId: receipt.mapId, operation: receipt.operation,
    payloadDigest: receipt.payloadDigest, baseVersion: receipt.baseVersion, resultVersion: receipt.resultVersion,
    resultCount: receipt.resultCount, createdAt: new Date(receipt.createdAt).toISOString() };
}
/** Must run inside the same canonical match/map transaction as facts and audit. */
export async function commitScoreboardReceipt(tx: TxDb, input: {
  actorUserId: string; mapId: string; operation: ScoreboardOperation; command: ScoreboardCommand;
  payloadDigest: string; resultVersion: string; resultCount: number;
}): Promise<ScoreboardReceipt> {
  const { actorUserId, mapId, operation, command, payloadDigest, resultVersion, resultCount } = input;
  const result = await tx.execute<ReceiptRow>(sql`insert into public.operator_scoreboard_receipts
    (actor_user_id, operation_id, map_id, operation, payload_digest, base_version, result_version, result_count)
    values (${actorUserId}::uuid, ${command.operationId}::uuid, ${mapId}::uuid, ${operation}, ${payloadDigest}, ${command.expectedVersion}, ${resultVersion}, ${resultCount})
    on conflict (actor_user_id, operation_id) do nothing
    returning actor_user_id as "actorUserId", operation_id as "operationId", map_id as "mapId", operation,
      payload_digest as "payloadDigest", base_version as "baseVersion", result_version as "resultVersion", result_count as "resultCount", created_at as "createdAt"`);
  const receipt = result.rows[0];
  // Same-map writers are serialized by the map lock. A cross-map reused ID may
  // race here: throwing rolls back this transaction's facts and audit too.
  if (!receipt) throw new ScoreboardConflict("操作编号已被使用，本次更改已回滚，请核对原操作。");
  return presentScoreboardReceipt(receipt);
}
