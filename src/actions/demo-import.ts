"use server";

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { parseDemoPackage } from "cs2-demo-format/parser";
import { loadDemoPackageFromZip } from "@cs2dak/core";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema/audit";
import { demoAnalysisRuns } from "@/db/schema/demo-analysis";
import { demoImports } from "@/db/schema/demo";
import { matchMaps } from "@/db/schema/match-maps";
import { matches } from "@/db/schema/matches";
import { seasons } from "@/db/schema/seasons";
import { userSteamAliases } from "@/db/schema/user-steam-aliases";
import { users } from "@/db/schema/users";
import { actionError } from "@/lib/action-utils";
import { createServiceClient } from "@/lib/auth/supabase";
import { auditActorId, requireAdmin } from "@/lib/auth/session";
import { buildMatchWorkspaceModel } from "@cs2dak/presentation";
import { buildDakMatchArtifactsFromPackage, compactMatchWorkspace } from "@/lib/demo/dak";
import { mapDemoPlayers } from "@/lib/demo/map-players";
import { AppError, ErrorCode } from "@/lib/errors";
import { fail, ok, type ActionResult } from "@/types/action";

const DEMO_BUCKET = "demo-imports";

export async function importDemoPackage(
  mapId: string,
  zipBuffer: ArrayBuffer,
  _opts?: { force?: boolean },
): Promise<ActionResult<{ importBatchId: string; unmatched: string[] }>> {
  try {
    const session = await requireAdmin();
    const actor = auditActorId(session);
    const map = await db.query.matchMaps.findFirst({ where: eq(matchMaps.id, mapId) });
    if (!map) return fail({ code: ErrorCode.NOT_FOUND, message: "地图记录不存在" });

    const match = await db.query.matches.findFirst({ where: eq(matches.id, map.matchId) });
    if (!match) return fail({ code: ErrorCode.NOT_FOUND, message: "比赛记录不存在" });
    if (match.status !== "finished") {
      return fail({ code: ErrorCode.MAP_NOT_FINISHED, message: "比赛未结束，无法导入 Demo" });
    }

    const parsed = await parseDemoPackage(zipBuffer);
    const demoHash = parsed.manifest.demo?.hash ?? "";
    const existing = await db.query.demoImports.findFirst({
      where: and(eq(demoImports.mapId, mapId), eq(demoImports.demoHash, demoHash)),
    });
    if (existing) {
      return fail({ code: ErrorCode.DUPLICATE_IMPORT, message: "该 Demo 已导入过（相同 hash + 地图）" });
    }

    const dak = buildDakMatchArtifactsFromPackage(await loadDemoPackageFromZip(zipBuffer));
    const fullWorkspace = buildMatchWorkspaceModel(dak.pkg);
    const zipObjectPath = `${match.seasonId}/${mapId}/${demoHash}.zip`;
    const workspaceObjectPath = `${match.seasonId}/${mapId}/${demoHash}-workspace.json`;

    const storage = createServiceClient().storage;
    const { data: bucketList } = await storage.listBuckets();
    if (!bucketList?.some((b) => b.name === DEMO_BUCKET)) {
      const { error: createError } = await storage.createBucket(DEMO_BUCKET, {
        public: false,
        fileSizeLimit: 524288000, // 500 MB
        allowedMimeTypes: ["application/zip", "application/json"],
      });
      if (createError) throw new AppError(ErrorCode.INTERNAL_ERROR, `Demo ZIP Bucket 创建失败：${createError.message}`);
    }

    const bucket = storage.from(DEMO_BUCKET);
    const [zipUpload, workspaceUpload] = await Promise.all([
      bucket.upload(zipObjectPath, zipBuffer, { contentType: "application/zip", upsert: false }),
      bucket.upload(workspaceObjectPath, JSON.stringify(fullWorkspace), {
        contentType: "application/json",
        upsert: false,
      }),
    ]);
    if (zipUpload.error) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, `Demo ZIP 保存失败：${zipUpload.error.message}`);
    }
    if (workspaceUpload.error) {
      // 非致命：ZIP 已保存，workspace 可后续重建
      console.error("完整 workspace JSON 上传失败（非致命）：", workspaceUpload.error.message);
    }

    const [userRows, aliasRows] = await Promise.all([
      db.select({ id: users.id, steam64: users.steam64 }).from(users).where(isNotNull(users.steam64)),
      db.select({ steamId64: userSteamAliases.steamId64, userId: userSteamAliases.userId }).from(userSteamAliases),
    ]);
    const steamIdToUserId = new Map<string, string>();
    for (const user of userRows) {
      if (user.steam64) steamIdToUserId.set(user.steam64, user.id);
    }
    for (const alias of aliasRows) {
      if (!steamIdToUserId.has(alias.steamId64)) steamIdToUserId.set(alias.steamId64, alias.userId);
    }
    const { unmatched } = mapDemoPlayers(parsed.files.players ?? [], steamIdToUserId);
    const now = new Date();

    const result = await db.transaction(async (tx) => {
      const oldBatchIds = await tx
        .select({ id: demoImports.id })
        .from(demoImports)
        .where(eq(demoImports.mapId, mapId))
        .then((rows) => rows.map((row) => row.id));
      if (oldBatchIds.length > 0) {
        await tx.update(demoImports).set({ isCurrent: false }).where(eq(demoImports.mapId, mapId));
        await tx.update(demoAnalysisRuns).set({ status: "superseded" }).where(inArray(demoAnalysisRuns.importId, oldBatchIds));
      }

      const [importRow] = await tx.insert(demoImports).values({
        mapId,
        demoHash,
        zipObjectPath,
        zipByteSize: zipBuffer.byteLength,
        manifest: parsed.manifest as Record<string, unknown>,
        supersedesImportId: oldBatchIds.at(-1),
        isCurrent: true,
        schemaVersion: parsed.manifest.schemaVersion,
        exporterName: parsed.manifest.exporter?.name ?? null,
        exporterVersion: parsed.manifest.exporter?.version ?? null,
        parserName: parsed.manifest.parser?.name ?? null,
        mapName: parsed.manifest.mapName,
        tickrate: parsed.manifest.tickrate,
        exportedAt: parsed.manifest.exportedAt ? new Date(parsed.manifest.exportedAt) : null,
        importedBy: session.userId,
        importedAt: now,
      }).returning({ id: demoImports.id });

      await tx.insert(demoAnalysisRuns).values({
        importId: importRow.id,
        status: "ready",
        analysisVersion: dak.analysis.provenance.analysisVersion,
        ratingVersion: dak.analysis.provenance.ratingVersions.valueAccounts,
        analysisBundle: dak.analysis,
        workspaceModel: dak.workspace,
        qaReport: dak.analysis.qa,
        completedAt: now,
      });

      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "match.import_dak_demo",
        actorId: actor,
        targetId: mapId,
        targetType: "match_map",
        meta: {
          importBatchId: importRow.id,
          demoHash,
          unmatchedCount: unmatched.length,
          matchId: map.matchId,
          analysisVersion: dak.analysis.provenance.analysisVersion,
        },
      });
      return { importBatchId: importRow.id, unmatched };
    });

    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, match.seasonId),
      columns: { slug: true },
    });
    const slug = season?.slug ?? "";
    revalidatePath(`/admin/${slug}/demos`);
    revalidatePath(`/${slug}/matches/${map.matchId}`);
    return ok(result);
  } catch (error) {
    return actionError("importDemoPackage", error);
  }
}
