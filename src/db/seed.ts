import { eq } from "drizzle-orm";
import { db } from "./client";
import { seasons } from "./schema/seasons";
import { adminUsers } from "./schema/admin-users";
import { users } from "./schema/users";
import { seasonRegistrations } from "./schema/registrations";
import { teams, teamMembers } from "./schema/teams";
import { matches } from "./schema/matches";
import { matchMaps } from "./schema/match-maps";
import {
  DRAFT_LEAGUE_PRESET,
  OPEN_TOURNAMENT_PRESET,
} from "@/types/season";
import { hashPassword } from "@/lib/utils/password";

export async function seed() {
  console.log("Seeding database...");

  // 1. 赛季种子数据
  await db
    .insert(seasons)
    .values([
      {
        slug: "2026-nju-rivals",
        name: "2026 NJU Rivals",
        kind: "选秀联赛",
        status: "registration",
        themeColor: "#f97316",
        ...DRAFT_LEAGUE_PRESET,
      },
      {
        slug: "spring-2026-league",
        name: "2026 春季选秀联赛",
        kind: "联赛",
        status: "draft",
        themeColor: "#f97316",
        ...DRAFT_LEAGUE_PRESET,
      },
      {
        slug: "autumn-2026-open",
        name: "2026 秋季公开赛",
        kind: "杯赛",
        status: "draft",
        themeColor: "#ef4444",
        ...OPEN_TOURNAMENT_PRESET,
      },
    ])
    .onConflictDoNothing();

  // 2. 根管理员（幂等）
  const [root] = await db
    .insert(adminUsers)
    .values({
      username: "RivalHub_root",
      passwordHash: hashPassword("RivalHub_password"),
      role: "super_admin",
    })
    .onConflictDoNothing()
    .returning();

  if (root) {
    console.log("Created root admin: RivalHub_root");
    console.warn(
      "\n⚠️  根管理员已创建，请立即登录后修改默认密码！\n" +
      "   用户名: RivalHub_root\n" +
      "   初始密码: RivalHub_password\n"
    );
  } else {
    console.log("Root admin already exists, skipping.");
  }

  // 3. 测试数据：playing 赛季 + 队伍 + 比赛（幂等：赛季不存在才创建）
  const existingPlayingSeason = await db.query.seasons.findFirst({
    where: eq(seasons.slug, "2025-njurivals-s1"),
  });

  if (!existingPlayingSeason) {
    console.log("Seeding playing season test data...");

    const [playingSeason] = await db
      .insert(seasons)
      .values({
        slug: "2025-njurivals-s1",
        name: "2025 NJU Rivals S1",
        kind: "选秀联赛",
        status: "playing",
        themeColor: "#3b82f6",
        ...DRAFT_LEAGUE_PRESET,
      })
      .returning();

    const TEAM_NAMES = ["Nova", "Frost", "Ember", "Abyss", "Specter", "Titan", "Vortex", "Cipher"];
    // 每队 7 人：igl / awper / opener / closer / anchor / opener(sub) / closer(sub)
    const TEAM_POSITIONS = ["igl", "awper", "opener", "closer", "anchor", "opener", "closer"] as const;
    const STARTER_MASK    = [true,  true,    true,     true,     true,      false,        false];
    const SECONDARY_MAP: Record<string, string> = {
      igl: "awper", awper: "opener", opener: "closer", closer: "anchor", anchor: "igl",
    };
    const RANKS   = ["A++", "A+",  "A+",  "A",   "A",   "B++", "B+"];
    // rating 均值约 1.0，we 均值约 8.0
    const RATINGS = [1.35,  1.15,  1.12,  1.00,  0.98,  0.88,  0.80];
    const WES     = [10.5,  9.2,   8.8,   8.0,   7.8,   6.5,   6.0];
    const STYLES  = ["积极进攻", "狙击支撑", "先锋突破", "残局收割", "稳守反推", "辅助支撑", "灵活游走"];

    // 创建 56 个用户
    const userRows = [];
    for (let t = 0; t < 8; t++) {
      for (let p = 0; p < 7; p++) {
        const idx = t * 7 + p + 1;
        userRows.push({
          email: `seed-p${String(idx).padStart(2, "0")}@rivalhu.b`,
          steamName: `${TEAM_NAMES[t]}_${TEAM_POSITIONS[p].toUpperCase()}_${idx}`,
          perfectId: `PW${100000 + idx}`,
        });
      }
    }
    const insertedUsers = await db.insert(users).values(userRows).returning();

    // 创建 56 条报名记录（全部 approved）
    const insertedRegs = await db
      .insert(seasonRegistrations)
      .values(
        insertedUsers.map((u, i) => {
          const posKey = TEAM_POSITIONS[i % 7];
          return {
            userId: u.id,
            seasonId: playingSeason.id,
            primaryPosition: posKey,
            secondaryPosition: SECONDARY_MAP[posKey],
            peakRank: RANKS[i % 7],
            peakRankSeason: "S1 2025",
            peakRating: RATINGS[i % 7],
            peakWe: WES[i % 7],
            currentSeasonPeakRank: RANKS[i % 7],
            currentRating: Math.round((RATINGS[i % 7] - 0.05) * 100) / 100,
            currentWe: Math.round((WES[i % 7] - 0.3) * 10) / 10,
            gameplayStyle: STYLES[i % 7],
            status: "approved" as const,
            willingToBeCaptain: i % 7 === 0,
          };
        })
      )
      .returning();

    // 创建 8 支队伍（每队第 0 位成员即 IGL 为队长）
    const insertedTeams = await db
      .insert(teams)
      .values(
        TEAM_NAMES.map((name, t) => ({
          seasonId: playingSeason.id,
          name: `Team ${name}`,
          captainRegistrationId: insertedRegs[t * 7].id,
          draftOrder: t + 1,
        }))
      )
      .returning();

    // 创建 56 条队伍成员记录
    await db.insert(teamMembers).values(
      insertedRegs.map((reg, i) => ({
        teamId: insertedTeams[Math.floor(i / 7)].id,
        registrationId: reg.id,
        isStarter: STARTER_MASK[i % 7],
      }))
    );

    const now = new Date();
    const DAY = 24 * 60 * 60 * 1000;

    // 创建 4 场比赛
    const insertedMatches = await db
      .insert(matches)
      .values([
        {
          seasonId: playingSeason.id,
          teamAId: insertedTeams[0].id,
          teamBId: insertedTeams[1].id,
          stage: "qualifier" as const,
          format: "bo3" as const,
          scoreA: 2,
          scoreB: 0,
          status: "finished" as const,
          scheduledAt: new Date(now.getTime() - 7 * DAY),
          completedAt: new Date(now.getTime() - 7 * DAY + 2 * 3600 * 1000),
        },
        {
          seasonId: playingSeason.id,
          teamAId: insertedTeams[2].id,
          teamBId: insertedTeams[3].id,
          stage: "qualifier" as const,
          format: "bo3" as const,
          scoreA: 1,
          scoreB: 2,
          status: "finished" as const,
          scheduledAt: new Date(now.getTime() - 5 * DAY),
          completedAt: new Date(now.getTime() - 5 * DAY + 3 * 3600 * 1000),
        },
        {
          seasonId: playingSeason.id,
          teamAId: insertedTeams[4].id,
          teamBId: insertedTeams[5].id,
          stage: "qualifier" as const,
          format: "bo3" as const,
          status: "in_progress" as const,
          scheduledAt: new Date(now.getTime() - 3600 * 1000),
        },
        {
          seasonId: playingSeason.id,
          teamAId: insertedTeams[6].id,
          teamBId: insertedTeams[7].id,
          stage: "qualifier" as const,
          format: "bo3" as const,
          status: "scheduled" as const,
          scheduledAt: new Date(now.getTime() + 2 * DAY),
        },
      ])
      .returning();

    // 已完成比赛的地图记录
    await db.insert(matchMaps).values([
      // Match 1: Nova 2:0 Frost
      {
        matchId: insertedMatches[0].id,
        mapOrder: 1,
        mapName: "de_mirage",
        pickedByTeamId: insertedTeams[0].id,
        teamAStartSide: "ct" as const,
        scoreA: 13,
        scoreB: 8,
        completedAt: new Date(now.getTime() - 7 * DAY + 3600 * 1000),
      },
      {
        matchId: insertedMatches[0].id,
        mapOrder: 2,
        mapName: "de_inferno",
        pickedByTeamId: insertedTeams[1].id,
        teamAStartSide: "t" as const,
        scoreA: 13,
        scoreB: 5,
        completedAt: new Date(now.getTime() - 7 * DAY + 2 * 3600 * 1000),
      },
      // Match 2: Ember 1:2 Abyss
      {
        matchId: insertedMatches[1].id,
        mapOrder: 1,
        mapName: "de_nuke",
        pickedByTeamId: insertedTeams[2].id,
        teamAStartSide: "ct" as const,
        scoreA: 13,
        scoreB: 7,
        completedAt: new Date(now.getTime() - 5 * DAY + 3600 * 1000),
      },
      {
        matchId: insertedMatches[1].id,
        mapOrder: 2,
        mapName: "de_ancient",
        pickedByTeamId: insertedTeams[3].id,
        teamAStartSide: "t" as const,
        scoreA: 5,
        scoreB: 13,
        completedAt: new Date(now.getTime() - 5 * DAY + 2 * 3600 * 1000),
      },
      {
        matchId: insertedMatches[1].id,
        mapOrder: 3,
        mapName: "de_dust2",
        pickedByTeamId: null,
        teamAStartSide: "t" as const,
        scoreA: 9,
        scoreB: 13,
        completedAt: new Date(now.getTime() - 5 * DAY + 3 * 3600 * 1000),
      },
    ]);

    console.log("Playing season test data seeded successfully.");
  } else {
    console.log("Playing season already seeded, skipping.");
  }

  console.log("Seed complete.");
}
