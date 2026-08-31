---
"rivalhub": patch
---

统一 v2.0 稳定收敛阶段的 Node 24 / pnpm 10 工具链与验证入口：数据库页面保持运行时读取，生产构建不再依赖数据库连接；Local real-PG、migration replay 与 browser E2E 现在由可复核的单一测试入口执行。
