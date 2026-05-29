"use server";

import { eq, and, inArray, asc, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { matchMaps } from "@/db/schema/match-maps";
import { matches } from "@/db/schema/matches";
import { teams } from "@/db/schema/teams";
import { users, seasonRegistrations, teamMembers } from "@/db/schema";
import { ok, type ActionResult } from "@/types/action";
import { actionError } from "@/lib/action-utils";
import { requireAdmin } from "@/lib/auth/session";

export interface ZipManifestInfo {
  /** zip 文件名（用于显示） */
  fileName: string;
  /** manifest.mapName，如 "de_ancient" */
  mapName: string;
  /** manifest.demo.hash */
  demoHash: string;
  /** match.json 里的 teamAName / teamBName（cs2-demo-format v1.0 均为 "Team A"/"Team B"） */
  teamAName?: string;
  teamBName?: string;
  /** 从文件名提取的比赛日期，如 "2026-05-18" */
  zipDate?: string;
  /** players.json 中的 steamId64 列表（用于模糊匹配） */
  steamId64s?: string[];
}

export interface MatchResult {
  fileName: string;
  mapId: string | null;
  confidence: "exact" | "fuzzy" | "none";
  /** 显示给用户看的比赛标签，如 "NJU Rivals vs AE Falcons · de_ancient · 2026-05-29" */
  matchLabel: string;
  /** 有多个候选时显示 */
  candidates: { mapId: string; label: string }[];
}

export async function matchZipsToMaps(
  seasonId: string,
  zips: ZipManifestInfo[],
): Promise<ActionResult<MatchResult[]>> {
  try {
    await requireAdmin();

    if (zips.length === 0) {
      return ok([]);
    }

    // 查询该赛季所有 finished 比赛及其 matchMaps
    const finishedMatches = await db.query.matches.findMany({
      where: and(
        eq(matches.seasonId, seasonId),
        eq(matches.status, "finished"),
      ),
      orderBy: [asc(matches.completedAt)],
    });

    if (finishedMatches.length === 0) {
      return ok(
        zips.map((z) => ({
          fileName: z.fileName,
          mapId: null,
          confidence: "none" as const,
          matchLabel: "",
          candidates: [],
        })),
      );
    }

    const matchIds = finishedMatches.map((m) => m.id);

    const allMaps = await db.query.matchMaps.findMany({
      where: inArray(matchMaps.matchId, matchIds),
      orderBy: [asc(matchMaps.matchId), asc(matchMaps.mapOrder)],
    });

    const allTeamIds = Array.from(
      new Set(finishedMatches.flatMap((m) => [m.teamAId, m.teamBId])),
    );

    const allTeams =
      allTeamIds.length > 0
        ? await db.query.teams.findMany({
            where: inArray(teams.id, allTeamIds),
          })
        : [];

    const teamNameById = new Map(allTeams.map((t) => [t.id, t.name]));
    const matchById = new Map(finishedMatches.map((m) => [m.id, m]));

    interface Candidate {
      mapId: string;
      matchId: string;
      mapName: string;
      completedAt: Date | null;
      teamAName: string;
      teamBName: string;
      teamAId: string;
      teamBId: string;
      label: string;
    }

    const candidates: Candidate[] = allMaps.map((mm) => {
      const match = matchById.get(mm.matchId)!;
      const teamAName = teamNameById.get(match.teamAId) ?? "队伍 A";
      const teamBName = teamNameById.get(match.teamBId) ?? "队伍 B";
      const dateStr = mm.completedAt
        ? mm.completedAt.toISOString().slice(0, 10)
        : (match.completedAt?.toISOString().slice(0, 10) ?? "未知日期");
      const label = `${teamAName} vs ${teamBName} · ${mm.mapName} · ${dateStr}`;
      return {
        mapId: mm.id,
        matchId: mm.matchId,
        mapName: mm.mapName,
        completedAt: mm.completedAt ?? match.completedAt ?? null,
        teamAName,
        teamBName,
        teamAId: match.teamAId,
        teamBId: match.teamBId,
        label,
      };
    });

    const results: MatchResult[] = await Promise.all(zips.map(async (zip) => {
      // 先按 mapName 过滤
      const byMap = candidates.filter(
        (c) => c.mapName.toLowerCase() === zip.mapName.toLowerCase(),
      );

      if (byMap.length === 0) {
        return {
          fileName: zip.fileName,
          mapId: null,
          confidence: "none" as const,
          matchLabel: "",
          candidates: [],
        };
      }

      // 日期匹配：文件名提取的比赛日期与 completedAt 比较（cs2-demo-format v1.0 无实义队名）
      let dateMatches: Candidate[];
      if (zip.zipDate) {
        dateMatches = byMap.filter((c) => {
          if (!c.completedAt) return false;
          const cd = new Date(c.completedAt).toISOString().slice(0, 10);
          return cd === zip.zipDate;
        });
      } else {
        dateMatches = [];
      }

      if (dateMatches.length === 1) {
        return {
          fileName: zip.fileName,
          mapId: dateMatches[0].mapId,
          confidence: "exact" as const,
          matchLabel: dateMatches[0].label,
          candidates: [],
        };
      }

      // 精确匹配：mapName 一致 + 队名 contains 匹配（不区分大小写）
      const exactMatches =
        zip.teamAName && zip.teamBName && zip.teamAName !== "Team A" && zip.teamBName !== "Team B"
          ? byMap.filter((c) => {
              const tA = zip.teamAName!.toLowerCase();
              const tB = zip.teamBName!.toLowerCase();
              const cA = c.teamAName.toLowerCase();
              const cB = c.teamBName.toLowerCase();
              // 正向匹配：A↔A, B↔B，或者 A↔B, B↔A（队伍顺序可能不同）
              return (
                ((cA.includes(tA) || tA.includes(cA)) &&
                  (cB.includes(tB) || tB.includes(cB))) ||
                ((cA.includes(tB) || tB.includes(cA)) &&
                  (cB.includes(tA) || tA.includes(cB)))
              );
            })
          : [];

      if (exactMatches.length === 1) {
        return {
          fileName: zip.fileName,
          mapId: exactMatches[0].mapId,
          confidence: "exact" as const,
          matchLabel: exactMatches[0].label,
          candidates: [],
        };
      }

      if (exactMatches.length > 1) {
        return {
          fileName: zip.fileName,
          mapId: null,
          confidence: "fuzzy" as const,
          matchLabel: "",
          candidates: exactMatches.map((c) => ({ mapId: c.mapId, label: c.label })),
        };
      }

      // 模糊匹配：mapName 一致，用队名做二次收窄
      const narrowed =
        zip.teamAName || zip.teamBName
          ? byMap.filter((c) => {
              const tA = (zip.teamAName ?? "").toLowerCase();
              const tB = (zip.teamBName ?? "").toLowerCase();
              const cA = c.teamAName.toLowerCase();
              const cB = c.teamBName.toLowerCase();
              if (tA && tB) {
                return (
                  (cA.includes(tA) || tA.includes(cA) ||
                    cB.includes(tA) || tA.includes(cB)) ||
                  (cA.includes(tB) || tB.includes(cA) ||
                    cB.includes(tB) || tB.includes(cB))
                );
              }
              if (tA) {
                return (
                  cA.includes(tA) || tA.includes(cA) ||
                  cB.includes(tA) || tA.includes(cB)
                );
              }
              if (tB) {
                return (
                  cA.includes(tB) || tB.includes(cA) ||
                  cB.includes(tB) || tB.includes(cB)
                );
              }
              return true;
            })
          : byMap;

      // 队名匹配无帮助时用日期收窄（cs2-demo-format 队名均为 "Team A"/"Team B"）
      const poolRaw = narrowed.length > 0 ? narrowed : byMap;
      const pool = (poolRaw.length > 1 && dateMatches.length > 0 && dateMatches.length < poolRaw.length)
        ? dateMatches
        : poolRaw;

      // steamId 模糊匹配：通过 ZIP 玩家查询队伍归属，缩小候选范围
      let playerMatchPool: Candidate[] | null = null;
      if (pool.length > 1 && zip.steamId64s && zip.steamId64s.length > 0) {
        try {
          const teamRows = await db.execute(sql`
            SELECT DISTINCT tm.team_id
            FROM ${users} u
            JOIN ${seasonRegistrations} sr ON sr.user_id = u.id AND sr.season_id = ${seasonId}
            JOIN ${teamMembers} tm ON tm.registration_id = sr.id
            WHERE u.steam64 = ANY(ARRAY[${sql.join(zip.steamId64s.map((s) => sql`${s}`), sql`, `)}])
          `);
          const zipTeamIds = new Set(teamRows.rows.map((r) => (r as Record<string, unknown>).team_id as string));
          if (zipTeamIds.size > 0) {
            const filtered = pool.filter((c) =>
              zipTeamIds.has(c.teamAId) || zipTeamIds.has(c.teamBId),
            );
            if (filtered.length > 0 && filtered.length < pool.length) {
              playerMatchPool = filtered;
            }
          }
        } catch {
          // steamId 匹配失败时忽略，继续使用原 pool
        }
      }

      const finalPool = playerMatchPool ?? pool;

      if (finalPool.length === 1) {
        return {
          fileName: zip.fileName,
          mapId: finalPool[0].mapId,
          confidence: "fuzzy" as const,
          matchLabel: finalPool[0].label,
          candidates: [],
        };
      }

      return {
        fileName: zip.fileName,
        mapId: null,
        confidence: "fuzzy" as const,
        matchLabel: "",
        candidates: finalPool.map((c) => ({ mapId: c.mapId, label: c.label })),
      };
    }));

    return ok(results);
  } catch (e) {
    return actionError("matchZipsToMaps", e);
  }
}
