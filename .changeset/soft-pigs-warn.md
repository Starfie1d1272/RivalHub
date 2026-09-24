---
"rivalhub": patch
---

报名名单校验在同一 PostgreSQL 事务中按序读取，避免事务连接上的查询重叠。
