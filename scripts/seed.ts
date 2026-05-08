// 种子脚本入口——调用 src/db/seed.ts
// 使用方式：pnpm seed（package.json 已配置 tsx scripts/seed.ts）
// 前置条件：DATABASE_URL 已配置（Phase 2+ 才运行）

import { config } from "dotenv";
config({ path: ".env.local" });

import { seed } from "../src/db/seed";

seed()
  .then(() => {
    console.log("种子脚本执行完成");
    process.exit(0);
  })
  .catch((err) => {
    console.error("种子脚本执行失败:", err);
    process.exit(1);
  });
