---
"rivalhub": patch
---

收敛 v2 stable 依赖安全边界：移除无实际 consumer 的数据库/环境加载与未使用 Radix direct dependencies；保留仍被当前依赖路径需要的精确 security overrides 与 patched lock graph；不改变赛事领域数据或产品行为。
