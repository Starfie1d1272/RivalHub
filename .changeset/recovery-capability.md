---
"rivalhub": patch
---

补齐 production 灾难恢复备份（Session Pooler :5432 独立连接与 read-only 契约）、R2 内容 read-back 与私有访问校验、migrations-first 隔离恢复通用 pre-import 清理与 replica 批量导入语义、Auth 恢复不变式、release 与备份串行化并发契约，以及 pre-release backup hard gate，为 destructive migration 提供发布前 backup 保护。
