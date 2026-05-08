import { db } from "./client";
import { seasons } from "./schema/seasons";
import {
  DRAFT_LEAGUE_PRESET,
  OPEN_TOURNAMENT_PRESET,
} from "@/types/season";

export async function seed() {
  console.log("Seeding database...");

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

  console.log("Seed complete.");
}
