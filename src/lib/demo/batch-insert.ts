import type { PgTable } from "drizzle-orm/pg-core";
import type { PgTransaction } from "drizzle-orm/pg-core";

/**
 * 安全分块批量插入，避免 PG 参数溢出（max_parameters = 65535）。
 *
 * 采用保守 chunk size（1000 行/批），覆盖所有 demo 表场景：
 * 最宽的 demoPlayerStats 有 25 列 → 1000×25 = 25000 params（< 65535/4 安全余量）
 * 极宽场景（假设 50 列）→ 1000×50 = 50000 params（仍安全）
 *
 * 调用方可传入更激进 chunkSize（如 3000）用于窄表优化。
 */
const DEFAULT_CHUNK_SIZE = 1000;

export async function batchInsert<
  T extends PgTable,
  TInsert extends Record<string, unknown>,
>(
  tx: PgTransaction<any, any, any>,
  table: T,
  rows: TInsert[],
  chunkSize = DEFAULT_CHUNK_SIZE,
): Promise<void> {
  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await tx.insert(table).values(chunk);
  }
}
