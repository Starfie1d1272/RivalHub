---
"rivalhub": patch
---

在 PostgreSQL CI 与 production migration 前增加 previous stable release → next schema 的兼容性门禁，阻止未完成 Expand → Switch → Contract 的破坏性数据库变更进入发布流程。
