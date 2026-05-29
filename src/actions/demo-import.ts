"use server";

import { eq, and, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { matchMaps } from "@/db/schema/match-maps";
import { matches } from "@/db/schema/matches";
import { matchPlayerStats } from "@/db/schema/player-stats";
import { users } from "@/db/schema/users";
import { userSteamAliases } from "@/db/schema/user-steam-aliases";
import { auditLogs } from "@/db/schema/audit";
import {
  demoImports, demoPlayers, demoRounds, demoPlayerStats as demoPlayerStatsTable,
  demoPlayerEconomies, demoKills, demoDamages, demoBlinds, demoBombs,
  demoClutches, demoGrenades, demoShots, demoPositions,
} from "@/db/schema/demo";
import { ok, fail, type ActionResult } from "@/types/action";
import { AppError, ErrorCode } from "@/lib/errors";
import { actionError } from "@/lib/action-utils";
import { requireAdmin, auditActorId } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import { parseDemoPackage } from "@/lib/demo/parse-package";
import { mapDemoPlayers } from "@/lib/demo/map-players";
import { toMatchPlayerStat, type DemoStatInput } from "@/lib/demo/to-match-player-stats";
import { batchInsert } from "@/lib/demo/batch-insert";
import { seasons } from "@/db/schema/seasons";
import { backfillSingleBatch } from "@/actions/backfill-economy";

type DemoSideVal = "t" | "ct" | "unknown";

export async function importDemoPackage(
  mapId: string,
  zipBuffer: ArrayBuffer,
  opts?: { confirmOverwriteOcr?: boolean; force?: boolean },
): Promise<ActionResult<{ importBatchId: string; unmatched: string[] }>> {
  try {
    const session = await requireAdmin();
    const actor = auditActorId(session);

    // 校验 map 存在且比赛已结束
    const map = await db.query.matchMaps.findFirst({ where: eq(matchMaps.id, mapId) });
    if (!map) return fail({ code: ErrorCode.NOT_FOUND, message: "地图记录不存在" });

    const match = await db.query.matches.findFirst({ where: eq(matches.id, map.matchId) });
    if (!match) return fail({ code: ErrorCode.NOT_FOUND, message: "比赛记录不存在" });
    if (match.status !== "finished") return fail({ code: ErrorCode.MAP_NOT_FINISHED, message: "比赛未结束，无法导入 Demo" });

    // 解析 zip
    const parsed = await parseDemoPackage(zipBuffer);
    const demoHash = parsed.manifest.demo?.hash ?? "";

    // 查重：同一 mapId + demoHash（force 模式下跳过）
    const existing = opts?.force
      ? null
      : await db.query.demoImports.findFirst({
          where: and(eq(demoImports.mapId, mapId), eq(demoImports.demoHash, demoHash)),
        });
    if (existing) return fail({ code: ErrorCode.DUPLICATE_IMPORT, message: "该 Demo 已导入过（相同 hash + 地图）" });

    // OCR 冲突检测（契约 E）
    const hasOcrRows = await db.query.matchPlayerStats.findFirst({
      where: and(eq(matchPlayerStats.mapId, mapId), eq(matchPlayerStats.source, "manual_ocr")),
    });
    if (hasOcrRows && opts?.confirmOverwriteOcr !== true) {
      return fail({ code: ErrorCode.OCR_EXISTS_NEEDS_CONFIRM, message: "该图已有 OCR 数据，导入 demo 将以 demo 为准（OCR 数据保留但不参与聚合），确认？" });
    }

    // 构造 steamId → userId Map
    const userRows = await db
      .select({ id: users.id, steam64: users.steam64 })
      .from(users)
      .where(isNotNull(users.steam64));
    const steamIdToUserId = new Map<string, string>();
    for (const u of userRows) {
      if (u.steam64) steamIdToUserId.set(u.steam64, u.id);
    }

    // 额外查询别名表（多账号支持）
    const aliasRows = await db
      .select({ steamId64: userSteamAliases.steamId64, userId: userSteamAliases.userId })
      .from(userSteamAliases);
    for (const a of aliasRows) {
      if (!steamIdToUserId.has(a.steamId64)) {
        steamIdToUserId.set(a.steamId64, a.userId);
      }
    }

    // 映射 demo players
    const { mapped: mappedPlayers, unmatched } = mapDemoPlayers(parsed.files.players ?? [], steamIdToUserId);
    const steamIdToName = new Map(mappedPlayers.map(p => [p.steamId64, p.name]));
    const steamIdToUserIdMap = new Map(mappedPlayers.map(p => [p.steamId64, p.userId]).filter(([, uid]) => uid !== null) as [string, string][]);

    const now = new Date();

    // ── 事务写库 ──
    const result = await db.transaction(async (tx) => {
      // 0. force 模式：删除该 map 的所有旧导入记录
      if (opts?.force) {
        const oldBatchIds = await tx
          .select({ id: demoImports.id })
          .from(demoImports)
          .where(eq(demoImports.mapId, mapId))
          .then((r) => r.map((b) => b.id));
        if (oldBatchIds.length > 0) {
          for (const tbl of [
            "demo_kills", "demo_damages", "demo_blinds", "demo_bombs",
            "demo_clutches", "demo_grenades", "demo_shots", "demo_positions",
            "demo_player_economies", "demo_player_stats", "demo_rounds", "demo_players",
          ]) {
            await tx.execute(
              sql`DELETE FROM ${sql.identifier(tbl)} WHERE import_batch_id = ANY(${oldBatchIds}::uuid[])`
            );
          }
          await tx.delete(demoImports).where(eq(demoImports.mapId, mapId));
        }
        await tx.delete(matchPlayerStats).where(
          and(eq(matchPlayerStats.mapId, mapId), eq(matchPlayerStats.source, "demo_import"))
        );
      }

      // 1. 插入 demoImports
      const [importRow] = await tx.insert(demoImports).values({
        mapId,
        demoHash,
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

      const batchId = importRow.id;

      // 2. 批量插入 demo_players
      if (mappedPlayers.length > 0) {
        await batchInsert(tx, demoPlayers,
          mappedPlayers.map(p => ({
            importBatchId: batchId,
            mapId,
            steamId64: p.steamId64,
            name: p.name,
            teamKey: p.teamKey,
            userId: p.userId ?? undefined,
          }))
        );
      }

      // 3. 批量插入 demo_rounds
      const rounds = parsed.files.rounds ?? [];
      if (rounds.length > 0) {
        await batchInsert(tx, demoRounds,
          rounds.map((r: Record<string, unknown>) => ({
            importBatchId: batchId,
            mapId,
            roundNumber: r.roundNumber as number,
            startTick: (r.startTick as number | null) ?? undefined,
            freezeEndTick: (r.freezeEndTick as number | null) ?? undefined,
            endTick: (r.endTick as number | null) ?? undefined,
            teamASide: (r.teamASide as DemoSideVal | null) ?? null,
            teamBSide: (r.teamBSide as DemoSideVal | null) ?? null,
            teamAScoreBefore: (r.teamAScoreBefore as number | null) ?? undefined,
            teamBScoreBefore: (r.teamBScoreBefore as number | null) ?? undefined,
            teamAEconomy: r.teamAEconomy ? JSON.stringify(r.teamAEconomy) : null,
            teamBEconomy: r.teamBEconomy ? JSON.stringify(r.teamBEconomy) : null,
            winnerTeamKey: (r.winnerTeamKey as string | null) ?? null,
            winnerSide: (r.winnerSide as DemoSideVal | null) ?? null,
            endReason: (r.endReason as string | null) ?? null,
          }))
        );
      }

      // 4. 批量插入 demo_player_stats（携带 userId 映射）
      const stats = parsed.files.playerStats ?? [];
      if (stats.length > 0) {
        await batchInsert(tx, demoPlayerStatsTable,
          stats.map((s: Record<string, unknown>) => ({
            importBatchId: batchId,
            mapId,
            steamId64: s.steamId64 as string,
            userId: (steamIdToUserIdMap.get(s.steamId64 as string) ?? null) ?? undefined,
            teamKey: s.teamKey as string,
            kills: (s.kills as number | null) ?? undefined,
            deaths: (s.deaths as number | null) ?? undefined,
            assists: (s.assists as number | null) ?? undefined,
            damageHealth: (s.damageHealth as number | null) ?? undefined,
            damageArmor: (s.damageArmor as number | null) ?? undefined,
            adr: (s.adr as number | null) ?? undefined,
            utilityDamage: (s.utilityDamage as number | null) ?? undefined,
            averageUtilityDamagePerRound: (s.averageUtilityDamagePerRound as number | null) ?? undefined,
            headshotCount: (s.headshotCount as number | null) ?? undefined,
            firstKillCount: (s.firstKillCount as number | null) ?? undefined,
            firstDeathCount: (s.firstDeathCount as number | null) ?? undefined,
            tradeKillCount: (s.tradeKillCount as number | null) ?? undefined,
            tradeDeathCount: (s.tradeDeathCount as number | null) ?? undefined,
            kast: (s.kast as number | null) ?? undefined,
            oneKillCount: (s.oneKillCount as number | null) ?? undefined,
            twoKillCount: (s.twoKillCount as number | null) ?? undefined,
            threeKillCount: (s.threeKillCount as number | null) ?? undefined,
            fourKillCount: (s.fourKillCount as number | null) ?? undefined,
            fiveKillCount: (s.fiveKillCount as number | null) ?? undefined,
            vsOneCount: (s.vsOneCount as number | null) ?? undefined,
            vsOneWonCount: (s.vsOneWonCount as number | null) ?? undefined,
            vsOneLostCount: (s.vsOneLostCount as number | null) ?? undefined,
            vsTwoCount: (s.vsTwoCount as number | null) ?? undefined,
            vsTwoWonCount: (s.vsTwoWonCount as number | null) ?? undefined,
            vsTwoLostCount: (s.vsTwoLostCount as number | null) ?? undefined,
            vsThreeCount: (s.vsThreeCount as number | null) ?? undefined,
            vsThreeWonCount: (s.vsThreeWonCount as number | null) ?? undefined,
            vsThreeLostCount: (s.vsThreeLostCount as number | null) ?? undefined,
            vsFourCount: (s.vsFourCount as number | null) ?? undefined,
            vsFourWonCount: (s.vsFourWonCount as number | null) ?? undefined,
            vsFourLostCount: (s.vsFourLostCount as number | null) ?? undefined,
            vsFiveCount: (s.vsFiveCount as number | null) ?? undefined,
            vsFiveWonCount: (s.vsFiveWonCount as number | null) ?? undefined,
            vsFiveLostCount: (s.vsFiveLostCount as number | null) ?? undefined,
            bombPlantedCount: (s.bombPlantedCount as number | null) ?? undefined,
            bombDefusedCount: (s.bombDefusedCount as number | null) ?? undefined,
            wallbangKillCount: (s.wallbangKillCount as number | null) ?? undefined,
            noScopeKillCount: (s.noScopeKillCount as number | null) ?? undefined,
            collateralKillCount: (s.collateralKillCount as number | null) ?? undefined,
          }))
        );
      }

      // 5. 批量插入 demo_player_economies
      const economies = parsed.files.playerEconomies ?? [];
      if (economies.length > 0) {
        await batchInsert(tx, demoPlayerEconomies,
          economies.map((e: Record<string, unknown>) => ({
            importBatchId: batchId, mapId,
            roundNumber: e.roundNumber as number,
            steamId64: e.steamId64 as string,
            teamKey: (e.teamKey as string | null) ?? null,
            side: (e.side as DemoSideVal | null) ?? null,
            startMoney: (e.startMoney as number | null) ?? undefined,
            moneySpent: (e.moneySpent as number | null) ?? undefined,
            equipmentValue: (e.equipmentValue as number | null) ?? undefined,
            type: (e.type as string | null) ?? null,
          }))
        );
      }

      // 6. 批量插入 demo_kills
      const kills = parsed.files.kills ?? [];
      if (kills.length > 0) {
        await batchInsert(tx, demoKills,
          kills.map((k: Record<string, unknown>) => ({
            importBatchId: batchId, mapId,
            roundNumber: k.roundNumber as number,
            tick: k.tick as number,
            killerSteamId64: (k.killerSteamId64 as string | null) ?? null,
            victimSteamId64: (k.victimSteamId64 as string | null) ?? null,
            assisterSteamId64: (k.assisterSteamId64 as string | null) ?? null,
            killerTeamKey: (k.killerTeamKey as string | null) ?? null,
            victimTeamKey: (k.victimTeamKey as string | null) ?? null,
            killerSide: (k.killerSide as DemoSideVal | null) ?? null,
            victimSide: (k.victimSide as DemoSideVal | null) ?? null,
            weapon: (k.weapon as string | null) ?? null,
            headshot: (k.headshot as boolean | null) ?? undefined,
            flashAssist: (k.flashAssist as boolean | null) ?? undefined,
            tradeKill: (k.tradeKill as boolean | null) ?? undefined,
            tradeDeath: (k.tradeDeath as boolean | null) ?? undefined,
            throughSmoke: (k.throughSmoke as boolean | null) ?? undefined,
            noScope: (k.noScope as boolean | null) ?? undefined,
            penetratedObjects: (k.penetratedObjects as number | null) ?? undefined,
            killerPosition: k.killerPosition as object | null,
            victimPosition: k.victimPosition as object | null,
          }))
        );
      }

      // 7. 批量插入 demo_damages
      const damages = parsed.files.damages ?? [];
      if (damages.length > 0) {
        await batchInsert(tx, demoDamages,
          damages.map((d: Record<string, unknown>) => ({
            importBatchId: batchId, mapId,
            roundNumber: d.roundNumber as number, tick: d.tick as number,
            attackerSteamId64: (d.attackerSteamId64 as string | null) ?? null,
            victimSteamId64: (d.victimSteamId64 as string | null) ?? null,
            attackerTeamKey: (d.attackerTeamKey as string | null) ?? null,
            victimTeamKey: (d.victimTeamKey as string | null) ?? null,
            attackerSide: (d.attackerSide as DemoSideVal | null) ?? null,
            victimSide: (d.victimSide as DemoSideVal | null) ?? null,
            weapon: (d.weapon as string | null) ?? null,
            hitgroup: (d.hitgroup as string | null) ?? null,
            healthDamage: (d.healthDamage as number | null) ?? undefined,
            armorDamage: (d.armorDamage as number | null) ?? undefined,
            victimHealthBefore: (d.victimHealthBefore as number | null) ?? undefined,
            victimHealthAfter: (d.victimHealthAfter as number | null) ?? undefined,
            victimArmorBefore: (d.victimArmorBefore as number | null) ?? undefined,
            victimArmorAfter: (d.victimArmorAfter as number | null) ?? undefined,
          }))
        );
      }

      // 8. 批量插入 demo_blinds
      const blinds = parsed.files.blinds ?? [];
      if (blinds.length > 0) {
        await batchInsert(tx, demoBlinds,
          blinds.map((b: Record<string, unknown>) => ({
            importBatchId: batchId, mapId,
            roundNumber: b.roundNumber as number, tick: b.tick as number,
            flasherSteamId64: (b.flasherSteamId64 as string | null) ?? null,
            flashedSteamId64: (b.flashedSteamId64 as string | null) ?? null,
            flasherTeamKey: (b.flasherTeamKey as string | null) ?? null,
            flashedTeamKey: (b.flashedTeamKey as string | null) ?? null,
            flasherSide: (b.flasherSide as DemoSideVal | null) ?? null,
            flashedSide: (b.flashedSide as DemoSideVal | null) ?? null,
            durationSeconds: (b.durationSeconds as number | null) ?? undefined,
          }))
        );
      }

      // 9. 批量插入 demo_bombs
      const bombs = parsed.files.bombs ?? [];
      if (bombs.length > 0) {
        await batchInsert(tx, demoBombs,
          bombs.map((b: Record<string, unknown>) => ({
            importBatchId: batchId, mapId,
            roundNumber: b.roundNumber as number, tick: b.tick as number,
            type: (b.type as string | null) ?? null,
            site: (b.site as string | null) ?? null,
            actorSteamId64: (b.actorSteamId64 as string | null) ?? null,
            actorTeamKey: (b.actorTeamKey as string | null) ?? null,
            actorSide: (b.actorSide as DemoSideVal | null) ?? null,
            position: b.position as object | null,
          }))
        );
      }

      // 10. 批量插入 demo_clutches
      const clutches = parsed.files.clutches ?? [];
      if (clutches.length > 0) {
        await batchInsert(tx, demoClutches,
          clutches.map((c: Record<string, unknown>) => ({
            importBatchId: batchId, mapId,
            roundNumber: c.roundNumber as number,
            tick: (c.tick as number | null) ?? undefined,
            clutcherSteamId64: (c.clutcherSteamId64 as string | null) ?? null,
            clutcherTeamKey: (c.clutcherTeamKey as string | null) ?? null,
            clutcherSide: (c.clutcherSide as DemoSideVal | null) ?? null,
            opponentCount: (c.opponentCount as number | null) ?? undefined,
            won: (c.won as boolean | null) ?? undefined,
            survived: (c.survived as boolean | null) ?? undefined,
            killCount: (c.killCount as number | null) ?? undefined,
          }))
        );
      }

      // 11. 批量插入 demo_grenades
      const grenades = parsed.files.grenades ?? [];
      if (grenades.length > 0) {
        await batchInsert(tx, demoGrenades,
          grenades.map((g: Record<string, unknown>) => ({
            importBatchId: batchId, mapId,
            roundNumber: g.roundNumber as number,
            throwTick: (g.throwTick as number | null) ?? undefined,
            effectTick: (g.effectTick as number | null) ?? undefined,
            grenade: (g.grenade as string | null) ?? null,
            throwerSteamId64: (g.throwerSteamId64 as string | null) ?? null,
            throwerTeamKey: (g.throwerTeamKey as string | null) ?? null,
            throwerSide: (g.throwerSide as DemoSideVal | null) ?? null,
            throwPosition: g.throwPosition as object | null,
            effectPosition: g.effectPosition as object | null,
          }))
        );
      }

      // 12. 批量插入 demo_shots
      const shots = parsed.files.shots ?? [];
      if (shots.length > 0) {
        await batchInsert(tx, demoShots,
          shots.map((s: Record<string, unknown>) => ({
            importBatchId: batchId, mapId,
            roundNumber: s.roundNumber as number, tick: s.tick as number,
            steamId64: (s.steamId64 as string | null) ?? null,
            teamKey: (s.teamKey as string | null) ?? null,
            side: (s.side as DemoSideVal | null) ?? null,
            weapon: (s.weapon as string | null) ?? null,
            position: s.position as object | null,
            velocity: s.velocity as object | null,
            yaw: (s.yaw as number | null) ?? undefined,
            pitch: (s.pitch as number | null) ?? undefined,
          }))
        );
      }

      // 13. 批量插入 demo_positions
      const positions = parsed.files.positions1s ?? [];
      if (positions.length > 0) {
        await batchInsert(tx, demoPositions,
          positions.map((p: Record<string, unknown>) => ({
            importBatchId: batchId, mapId,
            roundNumber: p.roundNumber as number, tick: p.tick as number,
            steamId64: p.steamId64 as string,
            teamKey: (p.teamKey as string | null) ?? null,
            side: (p.side as DemoSideVal | null) ?? null,
            alive: (p.alive as boolean | null) ?? undefined,
            position: p.position as object | null,
            yaw: (p.yaw as number | null) ?? undefined,
            pitch: (p.pitch as number | null) ?? undefined,
            health: (p.health as number | null) ?? undefined,
            armor: (p.armor as number | null) ?? undefined,
            money: (p.money as number | null) ?? undefined,
            activeWeapon: (p.activeWeapon as string | null) ?? null,
            flashDurationRemaining: (p.flashDurationRemaining as number | null) ?? undefined,
            hasBomb: (p.hasBomb as boolean | null) ?? undefined,
            hasDefuseKit: (p.hasDefuseKit as boolean | null) ?? undefined,
          }))
        );
      }

      // 14. UPSERT 回填 match_player_stats（并发安全，避免 DELETE+INSERT 幽灵删除）
      if (stats.length > 0) {
        const backfillRows = stats.map((s: Record<string, unknown>) => {
          const steamId = s.steamId64 as string;
          const name = steamIdToName.get(steamId) ?? steamId;
          const uid = steamIdToUserIdMap.get(steamId) ?? null;
          const row = toMatchPlayerStat(s as DemoStatInput, name, uid);
          return {
            matchId: map.matchId,
            mapId,
            perfectName: row.perfectName,
            userId: row.userId ?? undefined,
            kills: row.kills ?? undefined,
            deaths: row.deaths ?? undefined,
            assists: row.assists ?? undefined,
            adr: row.adr ?? undefined,
            hsPercent: row.hsPercent ?? undefined,
            firstKills: row.firstKills ?? undefined,
            multiKills: row.multiKills ?? undefined,
            clutches: row.clutches ?? undefined,
            source: row.source,
            verifiedByAdmin: actor,
          };
        });
        for (const row of backfillRows) {
          await tx.insert(matchPlayerStats).values(row).onConflictDoUpdate({
            target: [matchPlayerStats.mapId, matchPlayerStats.perfectName, matchPlayerStats.source],
            set: {
              kills: row.kills,
              deaths: row.deaths,
              assists: row.assists,
              adr: row.adr,
              hsPercent: row.hsPercent,
              firstKills: row.firstKills,
              multiKills: row.multiKills,
              clutches: row.clutches,
              userId: row.userId,
              verifiedByAdmin: row.verifiedByAdmin,
            },
          });
        }
      } else {
        // 无统计数据，清空该图之前可能残留的 demo_import 来源行
        await tx.delete(matchPlayerStats).where(
          and(eq(matchPlayerStats.mapId, mapId), eq(matchPlayerStats.source, "demo_import"))
        );
      }

      // 15. 设置生效来源为 demo_import（仅当有 playerStats 数据时）
      if (stats.length > 0) {
        await tx.update(matchMaps)
          .set({ activeStatSource: "demo_import" })
          .where(eq(matchMaps.id, mapId));
      }

      // 16. 审计日志
      await tx.insert(auditLogs).values({
        seasonId: match.seasonId,
        action: "match.import_demo",
        actorId: actor,
        targetId: mapId,
        targetType: "match_map",
        meta: {
          importBatchId: batchId,
          demoHash,
          unmatchedCount: unmatched.length,
          matchId: map.matchId,
        },
      });

      return { importBatchId: batchId, unmatched };
    });

    // 经济类型回填（不阻塞导入）
    backfillSingleBatch(result.importBatchId).catch(() => {});

    const season = await db.query.seasons.findFirst({
      where: eq(seasons.id, match.seasonId),
      columns: { slug: true },
    });
    const slug = season?.slug ?? "";
    revalidatePath(`/admin/${slug}/demos`);
    revalidatePath(`/${slug}/matches/${map.matchId}`);
    return ok(result);
  } catch (e) {
    return actionError("importDemoPackage", e);
  }
}
