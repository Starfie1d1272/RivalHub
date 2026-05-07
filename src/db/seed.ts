import { db } from "./client";
import { seasons } from "./schema/seasons";

// TODO: implement full seed with players, registrations, etc.
export async function seed() {
  console.log("Seeding database...");

  await db.insert(seasons).values([
    {
      slug: "rivals-2026-spring",
      name: "NJU Rivals 2026 Spring",
      kind: "rivals",
      status: "draft",
      themeColor: "#f97316",
    },
    {
      slug: "major-2026-autumn",
      name: "NJU Major 2026 Autumn",
      kind: "major",
      status: "draft",
      themeColor: "#ef4444",
    },
  ]).onConflictDoNothing();

  console.log("Seed complete.");
}
