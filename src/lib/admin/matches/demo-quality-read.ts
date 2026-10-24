import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { matchDemoImports, matchMaps, matches } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import { demoImportMetadataSelection } from "@/lib/demo-integration/metadata";
import { selectCurrentDemoImport } from "@/lib/demo-integration/read";
import { projectAdminDemoQuality } from "./demo-quality";

/** Advisory quality detail only; identity confirmation keeps its locked canonical workflow. */
export async function readAdminDemoQuality(input: { seasonId: string; matchId: string; mapId: string; importId: string }) {
  await requireSeasonAdmin(input.seasonId);
  const [map] = await db.select({ id: matchMaps.id, mapOrder: matchMaps.mapOrder, mapName: matchMaps.mapName })
    .from(matchMaps).innerJoin(matches, eq(matches.id, matchMaps.matchId))
    .where(and(eq(matchMaps.id, input.mapId), eq(matches.id, input.matchId), eq(matches.seasonId, input.seasonId)));
  if (!map) throw new AppError(ErrorCode.NOT_FOUND, "未找到可访问的地图。");
  const metadata = await db.select(demoImportMetadataSelection).from(matchDemoImports)
    .where(and(eq(matchDemoImports.matchMapId, map.id), eq(matchDemoImports.seasonId, input.seasonId), eq(matchDemoImports.matchId, input.matchId)))
    .orderBy(desc(matchDemoImports.createdAt));
  const current = selectCurrentDemoImport(metadata);
  if (current?.id !== input.importId || current.status !== "confirmed") {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "本图 Demo 状态已变化，请刷新工作台后重新核对。");
  }
  const [artifact] = await db.select().from(matchDemoImports).where(and(eq(matchDemoImports.id, current.id),
    eq(matchDemoImports.matchMapId, map.id), eq(matchDemoImports.seasonId, input.seasonId), eq(matchDemoImports.matchId, input.matchId)));
  if (!artifact) throw new AppError(ErrorCode.NOT_FOUND, "这份 Demo 数据已不可用，请刷新工作台。");
  return projectAdminDemoQuality(artifact, { mapOrder: map.mapOrder, mapName: map.mapName });
}
