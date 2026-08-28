import { db } from "./client";
import { adminUsers } from "./schema/admin-users";
import { hashPassword } from "@/lib/utils/password";

const ROOT_USERNAME_ENV = "RIVALHUB_ROOT_USERNAME";
const ROOT_PASSWORD_ENV = "RIVALHUB_ROOT_PASSWORD";

/**
 * 根管理员 seed（幂等）。
 *
 * Root 凭据只来自环境变量 RIVALHUB_ROOT_USERNAME / RIVALHUB_ROOT_PASSWORD：
 * - 两个变量都存在 → 使用显式值创建（已存在则跳过）
 * - 只存在一个 → 配置错误，抛错
 * - 两个都不存在 → 安全跳过；标准首个管理员 bootstrap 走 RIVALHUB_OWNER_EMAIL
 *
 * 任何环境下都不输出密码明文。
 */
export async function seed() {
  console.log("Seeding database...\n");

  const rootUsername = process.env[ROOT_USERNAME_ENV]?.trim();
  const rootPassword = process.env[ROOT_PASSWORD_ENV];

  if (rootUsername || rootPassword) {
    if (!rootUsername || !rootPassword) {
      throw new Error(
        `${ROOT_USERNAME_ENV} and ${ROOT_PASSWORD_ENV} must both be set (or both omitted).`
      );
    }

    // 根管理员（幂等）
    const [root] = await db
      .insert(adminUsers)
      .values({
        username: rootUsername,
        passwordHash: hashPassword(rootPassword),
        role: "super_admin",
      })
      .onConflictDoNothing()
      .returning();

    if (root) {
      console.log(`Created root admin: ${rootUsername}`);
    } else {
      console.log("Root admin already exists, skipping.");
    }
  } else {
    console.log(
      "Legacy Root seed skipped: register the configured RIVALHUB_OWNER_EMAIL through /login for the standard bootstrap path."
    );
  }

  console.log("\nSeed complete.");
}
