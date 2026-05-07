import { db } from "./client";
import { seasons } from "./schema/seasons";
import {
  RIVALS_DEFAULT_CAPABILITIES,
  MAJOR_DEFAULT_CAPABILITIES,
} from "@/types/season";

// TODO: 扩展为完整种子（含 admin invite code 校验记录、测试报名等）
// 当前仅插入两个赛季占位（Rivals 2026 Spring + Major 2026 Autumn）
export async function seed() {
  console.log("Seeding database...");

  await db
    .insert(seasons)
    .values([
      {
        slug: "rivals-2026-spring",
        name: "NJU Rivals 2026 Spring",
        kind: "rivals",
        status: "draft",
        themeColor: "#f97316",
        ...RIVALS_DEFAULT_CAPABILITIES,
      },
      {
        slug: "major-2026-autumn",
        name: "NJU Major 2026 Autumn",
        kind: "major",
        status: "draft",
        themeColor: "#ef4444",
        ...MAJOR_DEFAULT_CAPABILITIES,
      },
    ])
    .onConflictDoNothing();

  console.log("Seed complete.");
}
