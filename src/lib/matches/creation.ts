import "server-only";
import { z } from "zod";
import type { TxDb } from "@/db/client";
import { matches } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { getMaxMaps } from "@/types/match";
import { SUPPORTED_CS2_MAP_KEYS } from "@/lib/config/cs2-maps";

const side = z.object({ name: z.string().trim().min(1).max(120), logoUrl: z.url().nullable() }).strict();
const creationSchema = z.object({
  sides: z.object({ a: side, b: side }).strict(),
  format: z.enum(["bo1", "bo3", "bo5"]),
  mapPool: z.array(z.string().refine(map => (SUPPORTED_CS2_MAP_KEYS as readonly string[]).includes(map))).min(1).max(10).refine(maps => new Set(maps).size === maps.length),
  scheduledAt: z.date().nullable(),
}).strict().refine(input => input.mapPool.length >= getMaxMaps(input.format), { message: "地图池不足以完成本场赛制。", path: ["mapPool"] });

/** Transactional domain owner; the calling entrypoint owns authorization. No invitation or roster prerequisite. */
export async function createUnassociatedMatchInTx(tx: TxDb, input: unknown, actorId: string) {
  const { sides, mapPool, ...values } = creationSchema.parse(input);
  const [match] = await tx.insert(matches).values({ ...values, executionContext: { version: 1, sides, mapPool } }).returning();
  if (!match) throw new AppError(ErrorCode.INTERNAL_ERROR, "创建比赛失败。");
  await writeAuditInTx(tx, { action: "match.create", actorId, targetId: match.id, meta: { source: "unassociated" } });
  return match;
}
