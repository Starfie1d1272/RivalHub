---
"rivalhub": patch
---

收紧 immutable release retry 的 operator identity：手动重试只能从当前 main HEAD 发起，operator commit 必须具备 canonical main CI evidence，production migration 只消费 preflight 冻结的 operator SHA。
