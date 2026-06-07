"use server";

import { createHash } from "node:crypto";
import type { PlayerIdentityMap } from "@cs2dak/cohort";
import { loadDemoPackageFromZip } from "@cs2dak/core";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import {
  auditLogs,
  demoImports,
  matchMaps,
  matches,
  playerRatings,
  seasonAnalysisRuns,
  seasons,
  users,
  userSteamAliases,
} from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireSeasonAdmin } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/auth/supabase";
import { buildDakSeasonArtifacts } from "@/lib/demo/dak";
import { ErrorCode } from "@/lib/errors";
import { fail, ok, type ActionResult } from "@/types/action";

const DEMO_BUCKET = "demo-imports";

export async function recomputeSeasonRatings(
  seasonId: string,
): Promise<ActionResult<{ playerCount: number; weightsVersion: string }>> {
  try {
    const admin = await requireSeasonAdmin(seasonId);
    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, seasonId),
      columns: { slug: true },
    });
    if (!season) {
      return fail({ code: ErrorCode.NOT_FOUND, message: "赛季不存在" });
    }

    const imports = await db
      .select({
        importId: demoImports.id,
        mapId: demoImports.mapId,
        demoHash: demoImports.demoHash,
        zipObjectPath: demoImports.zipObjectPath,
      })
      .from(demoImports)
      .innerJoin(matchMaps, eq(matchMaps.id, demoImports.mapId))
      .innerJoin(matches, eq(matches.id, matchMaps.matchId))
      .where(and(
        eq(matches.seasonId, seasonId),
        eq(demoImports.isCurrent, true),
      ));

    if (imports.length === 0) {
      return fail({ code: ErrorCode.NOT_FOUND, message: "该赛季暂无当前 Demo ZIP" });
    }
    const missingZip = imports.find((row) => !row.zipObjectPath);
    if (missingZip) {
      return fail({
        code: ErrorCode.VALIDATION_FAILED,
        message: "存在尚未迁入不可变 ZIP 存储的 Demo，请先运行全量重建",
      });
    }

    const storage = createServiceClient().storage.from(DEMO_BUCKET);
    const packages = await Promise.all(imports.map(async (row) => {
      const { data, error } = await storage.download(row.zipObjectPath!);
      if (error) throw new Error(`下载 Demo ZIP 失败：${error.message}`);
      return {
        matchId: row.mapId,
        pkg: await loadDemoPackageFromZip(await data.arrayBuffer()),
      };
    }));

    const identityMap = await buildSeasonIdentityMap();
    const { cohort, leaderboard } = buildDakSeasonArtifacts(packages, identityMap);
    const sourceFingerprint = createHash("sha256")
      .update(imports.map((row) => `${row.mapId}:${row.demoHash}`).sort().join("\n"))
      .digest("hex");
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx.update(seasonAnalysisRuns)
        .set({ status: "superseded" })
        .where(and(
          eq(seasonAnalysisRuns.seasonId, seasonId),
          eq(seasonAnalysisRuns.status, "ready"),
        ));

      await tx.insert(seasonAnalysisRuns).values({
        seasonId,
        status: "ready",
        cohortVersion: cohort.version,
        ratingVersion: cohort.weightsVersion,
        sourceFingerprint,
        cohortBundle: cohort,
        leaderboardModel: leaderboard,
        completedAt: now,
      });

      await tx.delete(playerRatings).where(eq(playerRatings.seasonId, seasonId));
      if (cohort.players.length > 0) {
        await tx.insert(playerRatings).values(cohort.players.map((player) => ({
          seasonId,
          userId: player.externalUserId ?? undefined,
          steamId64: player.primarySteamId64,
          rrScore: player.accountRR.toString(),
          rrWeightsVersion: cohort.weightsVersion,
          prismFirepower: player.prism?.axes.firepower?.toString(),
          prismOpening: player.prism?.axes.opening?.toString(),
          prismClutch: player.prism?.axes.clutch?.toString(),
          prismSniping: player.prism?.axes.sniping?.toString(),
          prismSurvival: player.prism?.axes.survival?.toString(),
          prismUtility: player.prism?.axes.utility?.toString(),
          prismTrading: player.prism?.axes.trading?.toString(),
          prismEntry: player.prism?.axes.entry?.toString(),
          prismWeightsVersion: player.prism?.weightsVersion,
          mapCount: player.mapCount,
          computedAt: now,
        })));
      }

      await tx.insert(auditLogs).values({
        seasonId,
        action: "season.recompute_dak_analysis",
        actorId: auditActorId(admin),
        targetId: seasonId,
        targetType: "season",
        meta: {
          sourceFingerprint,
          importCount: imports.length,
          playerCount: cohort.players.length,
          weightsVersion: cohort.weightsVersion,
        },
      });
    });

    revalidatePath(`/${season.slug}/stats`);
    revalidatePath(`/${season.slug}/players`);
    revalidatePath(`/${season.slug}/teams`);
    return ok({ playerCount: cohort.players.length, weightsVersion: cohort.weightsVersion });
  } catch (error) {
    return actionError("recomputeSeasonRatings", error);
  }
}

async function buildSeasonIdentityMap(): Promise<PlayerIdentityMap> {
  const [userRows, aliases] = await Promise.all([
    db.select({
      id: users.id,
      steamId64: users.steam64,
      displayName: users.displayName,
      perfectName: users.perfectName,
      steamName: users.steamName,
    }).from(users),
    db.select({
      steamId64: userSteamAliases.steamId64,
      userId: userSteamAliases.userId,
    }).from(userSteamAliases),
  ]);
  const byUserId = new Map(userRows.map((user) => [user.id, user]));
  const identityMap: PlayerIdentityMap = {};
  const add = (steamId64: string | null, userId: string) => {
    if (!steamId64) return;
    const user = byUserId.get(userId);
    identityMap[steamId64] = {
      playerKey: `user:${userId}`,
      userId,
      displayName: user?.displayName ?? user?.perfectName ?? user?.steamName ?? steamId64,
    };
  };
  for (const user of userRows) add(user.steamId64, user.id);
  for (const alias of aliases) add(alias.steamId64, alias.userId);
  return identityMap;
}
