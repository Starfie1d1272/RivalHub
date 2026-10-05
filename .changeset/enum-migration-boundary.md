---
"rivalhub": patch
---

完整 migration replay、Preview mirror 与 recovery restore 在 PostgreSQL enum 扩展后提交事务，使后续 migration 可以安全使用新增 enum value，保留原始 active chain SQL 和 ledger hash。
