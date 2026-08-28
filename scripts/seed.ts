// 种子脚本入口——调用 src/db/seed.ts
// 使用方式：显式声明目标与 DATABASE_URL 后运行 pnpm seed。
// 本地开发统一使用 pnpm db:local:seed，禁止回退到 .env.local。

import { assertDeclaredDatabaseTarget } from "./db/local-environment";

async function main(): Promise<void> {
  assertDeclaredDatabaseTarget(process.env);
  const { seed } = await import("../src/db/seed");
  await seed();
}

main()
  .then(() => {
    console.log("种子脚本执行完成");
    process.exit(0);
  })
  .catch((err) => {
    console.error("种子脚本执行失败:", err);
    process.exit(1);
  });
