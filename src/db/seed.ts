import { db } from "./client";
import { seasons } from "./schema/seasons";
import { adminUsers } from "./schema/admin-users";
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
  } else {
    console.log("Root admin already exists, skipping.");
  }

  console.log("Seed complete.");
}
