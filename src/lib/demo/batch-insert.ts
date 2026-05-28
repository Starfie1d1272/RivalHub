import type { PgTable } from "drizzle-orm/pg-core";
import type { PgTransaction } from "drizzle-orm/pg-core";

/**
 * 安全分块批量插入，避免 PG 参数溢出（max_parameters = 65535）。
 * 每批最多 CHUNK_SIZE 行，安全余量 1/4。
 */
const CHUNK_SIZE = 3000;

export async function batchInsert<
  T extends PgTable,
  TInsert extends Record<string, unknown>,
>(
  tx: PgTransaction<any, any, any>,
  table: T,
  rows: TInsert[],
  chunkSize = CHUNK_SIZE,
): Promise<void> {
  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await tx.insert(table).values(chunk);
  }
}
