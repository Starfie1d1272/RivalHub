"use server";

import { eq, and, inArray, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { matchMaps } from "@/db/schema/match-maps";
import { matches } from "@/db/schema/matches";
import { teams } from "@/db/schema/teams";
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
  /** match.json 里的 teamAName / teamBName */
  teamAName?: string;
  teamBName?: string;
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
      mapName: string;
      completedAt: Date | null;
      teamAName: string;
      teamBName: string;
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
        mapName: mm.mapName,
        completedAt: mm.completedAt ?? match.completedAt ?? null,
        teamAName,
        teamBName,
        label,
      };
    });

    const results: MatchResult[] = zips.map((zip) => {
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

      // 精确匹配：mapName 一致 + 队名 contains 匹配（不区分大小写）
      const exactMatches =
        zip.teamAName && zip.teamBName
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

      const pool = narrowed.length > 0 ? narrowed : byMap;

      if (pool.length === 1) {
        return {
          fileName: zip.fileName,
          mapId: pool[0].mapId,
          confidence: "fuzzy" as const,
          matchLabel: pool[0].label,
          candidates: [],
        };
      }

      return {
        fileName: zip.fileName,
        mapId: null,
        confidence: "fuzzy" as const,
        matchLabel: "",
        candidates: pool.map((c) => ({ mapId: c.mapId, label: c.label })),
      };
    });

    return ok(results);
  } catch (e) {
    return actionError("matchZipsToMaps", e);
  }
}
