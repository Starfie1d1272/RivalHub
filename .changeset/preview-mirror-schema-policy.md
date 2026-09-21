---
"rivalhub": patch
---

修复 Preview mirror 在 production 与 `main` schema 处于 N/N+1 时的兼容性，并为 `Refresh Preview Data` 提供可诊断且不泄漏敏感数据的失败日志。
