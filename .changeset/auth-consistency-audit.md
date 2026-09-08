---
"rivalhub": patch
---

新增 Auth ↔ canonical user 一致性审计与受保护的单用户 repair dry-run/apply 运维入口，帮助管理员区分正常待确认注册、stale orphan 与 identity ownership conflict，并避免在诊断输出中泄露完整邮箱。
