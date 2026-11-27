---
"rivalhub": patch
---

修复战绩纪录的 `freezeEnd` 装备取样版本识别，对 `cs2-demo-format/3.0` 契约下所有 `cs2df >=3.0.0` 正式导出版本（含 `3.0.x`、`3.1.x` 与 `4.x`）统一识别为 `freezeEnd`，避免合法版本被误判为 `unverified`。
