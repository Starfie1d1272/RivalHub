import { eq } from "drizzle-orm";
import { db } from "./client";
import { seasons } from "./schema/seasons";
import { adminUsers } from "./schema/admin-users";
import { users } from "./schema/users";
import { seasonRegistrations } from "./schema/registrations";
import { teams, teamMembers } from "./schema/teams";
import { matches } from "./schema/matches";
import { matchMaps } from "./schema/match-maps";
import { matchPlayerStats } from "./schema/player-stats";
import { DRAFT_LEAGUE_PRESET } from "@/types/season";
import { hashPassword } from "@/lib/utils/password";

export async function seed() {
  console.log("Seeding database...\n");

  // ── 1. 根管理员（幂等）──────────────────────────────────────
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
    console.log("Created root admin: RivalHub_root / RivalHub_password");
  } else {
    console.log("Root admin already exists, skipping.");
  }

  // ── 2. 测试赛季（幂等）──────────────────────────────────────
  const testSlug = "2025-njurivals-s1";

  const existing = await db.query.seasons.findFirst({
    where: eq(seasons.slug, testSlug),
  });

  if (existing) {
    console.log(`\nTest season "${testSlug}" already exists, skipping seed data.`);
    console.log("Seed complete.");
    return;
  }

  console.log("\nCreating test season with full data...\n");

  const [testSeason] = await db
    .insert(seasons)
    .values({
      slug: testSlug,
      name: "2025 NJU Rivals S1",
      kind: "选秀联赛",
      status: "playing",
      themeColor: "#3b82f6",
      ...DRAFT_LEAGUE_PRESET,
    })
    .returning();

  // ── 3. 选手 + 报名 + 队伍 ────────────────────────────────────
  const TEAM_NAMES = ["Nova", "Frost", "Ember", "Abyss", "Specter", "Titan", "Vortex", "Cipher"];
  const POSITIONS = ["igl", "awper", "opener", "closer", "anchor", "opener", "closer"] as const;
  const STARTER =    [true,  true,    true,     true,     true,     false,   false];
  const SEC_POS: Record<string, string> = {
    igl: "awper", awper: "opener", opener: "closer", closer: "anchor", anchor: "igl",
  };
  const RANKS =    ["A++", "A+", "A+", "A", "A", "B++", "B+"];
  const RATINGS =  [1.35,  1.15, 1.12, 1.00, 0.98, 0.88, 0.80];
  const WES =      [10.5,  9.2,  8.8,  8.0,  7.8,  6.5,  6.0];
  const STYLES =   ["积极进攻", "狙击支撑", "先锋突破", "残局收割", "稳守反推", "辅助支撑", "灵活游走"];

  // 56 个测试用户
  const userRows = [];
  for (let t = 0; t < 8; t++) {
    for (let p = 0; p < 7; p++) {
      const idx = t * 7 + p + 1;
      userRows.push({
        email: `seed-p${String(idx).padStart(2, "0")}@rivalhub.test`,
        steamName: `${TEAM_NAMES[t]}_${POSITIONS[p].toUpperCase()}_${idx}`,
        perfectName: `${TEAM_NAMES[t]}_${POSITIONS[p].toUpperCase()}`,
      });
    }
  }
  const insertedUsers = await db.insert(users).values(userRows).returning();

  // 报名
  const insertedRegs = await db
    .insert(seasonRegistrations)
    .values(
      insertedUsers.map((u, i) => {
        const pos = POSITIONS[i % 7];
        return {
          userId: u.id,
          seasonId: testSeason.id,
          primaryPosition: pos,
          secondaryPosition: SEC_POS[pos],
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

  // 队伍
  const insertedTeams = await db
    .insert(teams)
    .values(
      TEAM_NAMES.map((name, t) => ({
        seasonId: testSeason.id,
        name: `Team ${name}`,
        captainRegistrationId: insertedRegs[t * 7].id,
        draftOrder: t + 1,
      }))
    )
    .returning();

  // 队员
  await db.insert(teamMembers).values(
    insertedRegs.map((reg, i) => ({
      teamId: insertedTeams[Math.floor(i / 7)].id,
      registrationId: reg.id,
      isStarter: STARTER[i % 7],
    }))
  );

  // ── 4. 比赛 + 地图 + 玩家数据 ─────────────────────────────────
  const now = new Date();
  const DAY = 24 * 60 * 60 * 1000;
  const adminActor = "seed";

  // 每队出场 3 次，每个选手 3 条数据 → 刚好过排行榜 HAVING >= 3 门槛
  // [teamA idx, teamB idx, daysOffset, scoreA, scoreB, mapName, status]
  const matchDefs: [number, number, number, number, number, string, "finished" | "in_progress" | "scheduled"][] = [
    [0, 1, -14, 13, 8,  "de_mirage",   "finished"],
    [0, 3, -11, 13, 10, "de_dust2",    "finished"],
    [0, 2, -2,  0,  0,  "de_anubis",   "in_progress"],
    [1, 4, -13, 13, 9,  "de_ancient",  "finished"],
    [1, 5, -1,  0,  0,  "de_overpass", "in_progress"],
    [2, 6, -12, 5,  13, "de_inferno",  "finished"],
    [2, 4, -10, 13, 7,  "de_nuke",     "finished"],
    [3, 7, -9,  13, 11, "de_vertigo",  "finished"],
    [3, 5, -8,  13, 6,  "de_ancient",  "finished"],
    [4, 6, -5,  0,  0,  "de_dust2",    "in_progress"],
    [5, 6, -6,  13, 5,  "de_mirage",   "finished"],
    [6, 7, 2,   0,  0,  "de_nuke",     "scheduled"],
  ];

  for (const [a, b, day, sa, sb, mapName, status] of matchDefs) {
    // 创建比赛
    const [match] = await db
      .insert(matches)
      .values({
        seasonId: testSeason.id,
        teamAId: insertedTeams[a].id,
        teamBId: insertedTeams[b].id,
        stage: "qualifier",
        format: "bo1",
        scoreA: status === "finished" ? sa : null,
        scoreB: status === "finished" ? sb : null,
        status,
        scheduledAt: new Date(now.getTime() + day * DAY),
        completedAt: status === "finished" ? new Date(now.getTime() + day * DAY + 2 * 3600 * 1000) : null,
      })
      .returning();

    // 创建地图
    const [map] = await db
      .insert(matchMaps)
      .values({
        matchId: match.id,
        mapOrder: 1,
        mapName,
        pickedByTeamId: null,
        teamAStartSide: "ct",
        scoreA: status === "finished" ? sa : null,
        scoreB: status === "finished" ? sb : null,
        completedAt: status === "finished" ? new Date(now.getTime() + day * DAY + 2 * 3600 * 1000) : null,
      })
      .returning();

    // 为 finished / in_progress 比赛生成玩家数据
    if (status !== "scheduled") {
      const teamAUsers = insertedUsers.slice(a * 7, a * 7 + 5); // 仅首发 5 人
      const teamBUsers = insertedUsers.slice(b * 7, b * 7 + 5);

      const statsRows = [];
      for (let pi = 0; pi < 5; pi++) {
        // A 队
        const perfNameA = teamAUsers[pi].perfectName!;
        statsRows.push({
          matchId: match.id,
          mapId: map.id,
          perfectName: perfNameA,
          userId: teamAUsers[pi].id,
          kills: Math.round(RATINGS[pi] * 13 + (status === "finished" ? (sa - 5) : 1)),
          deaths: Math.max(1, Math.round(14 - RATINGS[pi] * 4)),
          assists: Math.round(RATINGS[pi] * 5),
          hsPercent: Math.min(100, Math.round(RATINGS[pi] * 30 + 20)),
          firstKills: Math.round(RATINGS[pi] * 2.5),
          multiKills: Math.max(0, Math.round(RATINGS[pi] - 0.5)),
          clutches: pi === 3 ? (RATINGS[pi] > 1 ? 2 : 1) : 0,
          adr: Math.round(RATINGS[pi] * 65 + 10),
          rws: Number((RATINGS[pi] * 8 + 2).toFixed(1)),
          ratingPro: Number(RATINGS[pi].toFixed(2)),
          we: Number(WES[pi].toFixed(1)),
          verifiedByAdmin: adminActor,
          verifiedAt: new Date(),
        });
        // B 队
        const perfNameB = teamBUsers[pi].perfectName!;
        const ri = 4 - pi; // 反向索引让 B 队也有高低分布
        statsRows.push({
          matchId: match.id,
          mapId: map.id,
          perfectName: perfNameB,
          userId: teamBUsers[pi].id,
          kills: Math.round(RATINGS[ri] * 11 + (status === "finished" ? (sb - 5) : 1)),
          deaths: Math.max(1, Math.round(14 - RATINGS[ri] * 4)),
          assists: Math.round(RATINGS[ri] * 4.5),
          hsPercent: Math.min(100, Math.round(RATINGS[ri] * 25 + 15)),
          firstKills: Math.round(RATINGS[ri] * 2),
          multiKills: Math.max(0, Math.round(RATINGS[ri] - 0.6)),
          clutches: pi === 3 ? 1 : 0,
          adr: Math.round(RATINGS[ri] * 60 + 8),
          rws: Number((RATINGS[ri] * 7 + 1).toFixed(1)),
          ratingPro: Number(RATINGS[ri].toFixed(2)),
          we: Number(WES[ri].toFixed(1)),
          verifiedByAdmin: adminActor,
          verifiedAt: new Date(),
        });
      }
      await db.insert(matchPlayerStats).values(statsRows);
    }
  }

  const totalStats = matchDefs.filter(([, , , , , , s]) => s !== "scheduled").length * 10;

  console.log(`Created: ${insertedUsers.length} players, ${insertedTeams.length} teams, ${matchDefs.length} matches with maps, ${totalStats} player stat rows`);
  console.log("\nSeed complete.");
}
