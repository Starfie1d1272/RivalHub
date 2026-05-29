"use server";

import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { matches } from "@/db/schema/matches";
import { matchMaps } from "@/db/schema/match-maps";
import { ok, fail, type ActionResult } from "@/types/action";
import { ErrorCode } from "@/lib/errors";
import { demoImports, demoPlayerStats, demoPlayers, demoRounds } from "@/db/schema/demo";
import { teamMembers } from "@/db/schema/teams";
import { seasonRegistrations } from "@/db/schema/registrations";

export interface TeamStyleProfile {
  teamId: string;
  teamName: string;
  firstKillRate: number | null;
  clutchWinRate: number | null;
  ecoConversion: Record<string, { played: number; won: number; winRate: number }>;
  totalRounds: number;
}

/**
 * 获取队伍风格画像：开局倾向、残局能力、经济转化
 */
export async function getTeamStyleProfile(
  teamId: string,
  seasonId: string,
): Promise<ActionResult<TeamStyleProfile>> {
  try {
    // 1. 找到队伍所有成员的 userId（通过 teamMembers → seasonRegistrations）
    const members = await db
      .select({ userId: seasonRegistrations.userId })
      .from(teamMembers)
      .innerJoin(seasonRegistrations, eq(teamMembers.registrationId, seasonRegistrations.id))
      .where(eq(teamMembers.teamId, teamId));
    const userIds = members.map((m) => m.userId).filter(Boolean) as string[];

    if (userIds.length === 0) {
      return ok({
        teamId,
        teamName: "",
        firstKillRate: null,
        clutchWinRate: null,
        ecoConversion: {},
        totalRounds: 0,
      });
    }

    // 2. 用这些 userIds 查 demoPlayerStats，获取 firstKill 和 clutch 数据
    const playerStats = await db
      .select({
        firstKillCount: demoPlayerStats.firstKillCount,
        firstDeathCount: demoPlayerStats.firstDeathCount,
        vsOneWonCount: demoPlayerStats.vsOneWonCount,
        vsTwoWonCount: demoPlayerStats.vsTwoWonCount,
        vsThreeWonCount: demoPlayerStats.vsThreeWonCount,
        vsFourWonCount: demoPlayerStats.vsFourWonCount,
        vsFiveWonCount: demoPlayerStats.vsFiveWonCount,
        vsOneCount: demoPlayerStats.vsOneCount,
        vsTwoCount: demoPlayerStats.vsTwoCount,
        vsThreeCount: demoPlayerStats.vsThreeCount,
        vsFourCount: demoPlayerStats.vsFourCount,
        vsFiveCount: demoPlayerStats.vsFiveCount,
      })
      .from(demoPlayerStats)
      .innerJoin(demoImports, eq(demoPlayerStats.importBatchId, demoImports.id))
      .innerJoin(matchMaps, eq(demoImports.mapId, matchMaps.id))
      .innerJoin(matches, eq(matchMaps.matchId, matches.id))
      .where(
        and(
          inArray(demoPlayerStats.userId, userIds),
          eq(matches.seasonId, seasonId),
          eq(matchMaps.activeStatSource, "demo_import"),
        ),
      );

    const totalFirstKills = playerStats.reduce((s, r) => s + Number(r.firstKillCount ?? 0), 0);
    const totalFirstDeaths = playerStats.reduce((s, r) => s + Number(r.firstDeathCount ?? 0), 0);
    const totalClutchWins = playerStats.reduce(
      (s, r) => s + Number(r.vsOneWonCount ?? 0) + Number(r.vsTwoWonCount ?? 0) + Number(r.vsThreeWonCount ?? 0) + Number(r.vsFourWonCount ?? 0) + Number(r.vsFiveWonCount ?? 0),
      0,
    );
    const totalClutchPlayed = playerStats.reduce(
      (s, r) => s + Number(r.vsOneCount ?? 0) + Number(r.vsTwoCount ?? 0) + Number(r.vsThreeCount ?? 0) + Number(r.vsFourCount ?? 0) + Number(r.vsFiveCount ?? 0),
      0,
    );

    const firstKillRate = (totalFirstKills + totalFirstDeaths) > 0 ? totalFirstKills / (totalFirstKills + totalFirstDeaths) : null;
    const clutchWinRate = totalClutchPlayed > 0 ? totalClutchWins / totalClutchPlayed : null;

    // 3. 查队伍比赛的 rounds 做经济转化率（按 teamId 过滤）
    const ecoRows = await db.execute(sql`
      SELECT
        CASE WHEN m.team_a_id = ${teamId} THEN dr.team_a_economy
             WHEN m.team_b_id = ${teamId} THEN dr.team_b_economy
             ELSE NULL END AS economy,
        CASE WHEN m.team_a_id = ${teamId} THEN dr.team_a_key
             WHEN m.team_b_id = ${teamId} THEN dr.team_b_key
             ELSE NULL END AS team_key,
        dr.winner_team_key
      FROM demo_rounds dr
      JOIN demo_imports di ON dr.import_batch_id = di.id
      JOIN match_maps mm ON di.map_id = mm.id
      JOIN matches m ON mm.match_id = m.id
      WHERE m.season_id = ${seasonId}
        AND mm.active_stat_source = 'demo_import'
        AND (m.team_a_id = ${teamId} OR m.team_b_id = ${teamId})
    `);

    // 4. 按 eco/force/semi/full 统计该队 winRate
    const ecoStats: Record<string, { played: number; won: number }> = {};

    for (const row of ecoRows.rows as {
      economy: string | null;
      team_key: string | null;
      winner_team_key: string | null;
    }[]) {
      if (!row.economy) continue;
      const g = ecoStats[row.economy] ?? { played: 0, won: 0 };
      g.played += 1;
      if (row.winner_team_key === row.team_key) g.won += 1;
      ecoStats[row.economy] = g;
    }

    const ecoConversion: Record<string, { played: number; won: number; winRate: number }> = {};
    for (const [economy, s] of Object.entries(ecoStats)) {
      ecoConversion[economy] = {
        played: s.played,
        won: s.won,
        winRate: s.played > 0 ? s.won / s.played : 0,
      };
    }

    // 5. 取队伍名
    const teamRes = await db.execute(sql`
      SELECT name FROM teams WHERE id = ${teamId}
    `);
    const teamName = ((teamRes.rows[0] as { name?: string })?.name) ?? "";

    return ok({
      teamId,
      teamName,
      firstKillRate,
      clutchWinRate,
      ecoConversion,
      totalRounds: Object.values(ecoStats).reduce((s, g) => s + g.played, 0),
    });
  } catch (e) {
    return fail({ code: ErrorCode.INTERNAL_ERROR, message: String(e) });
  }
}
