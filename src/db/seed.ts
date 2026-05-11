import { db } from "./client";
import { adminUsers } from "./schema/admin-users";
import { hashPassword } from "@/lib/utils/password";

export async function seed() {
  console.log("Seeding database...\n");

  // 根管理员（幂等）
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

  console.log("\nSeed complete.");
}
