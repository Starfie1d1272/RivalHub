# 产品遥测本地证据（2026-10-17）

基线 main：`a1051ea7`。执行前通过 GitHub API 与本地 fetch 核对；开放 PR 仅 #944（界面重设计）和 #936（actions/cache 更新），没有重复产品遥测 PR。Mizar #398 仅只读参考其草稿说明，未修改其分支/资源。

`measurement.json` 由 `pnpm telemetry:measure` 产生，`source-sha256.txt` 标识被测源码；构建/部署的完整 SHA 以交付 PR 为准。场景是每会话活跃 30 分钟，每分钟一次导航/筛选和两次显式动作，总计 150 条事件、30 次直传，无新增 Vercel 采集请求。空闲轮询不注入动作。合成场景不是线上 DAU、用户行为分布或费用证明。

- Chromium 153：client core 19,166 bytes，gzip 6,301 bytes；动作包装 p50 0.1ms、p95 1.8ms、max 2.8ms。本数值不是全部 Next chunks 的增量，组件显式 wrappers、React observer 和既有 Vercel SDK 不计入此独立 core bundle。
- Node 中签发账号 HMAC+票据 p95 1.05ms；本地 workerd 完整 POST wall p95 31.19ms（包含本地调度、SQLite/RPC，不是 Worker CPU 时间，更不能对比线上 Free 的 10ms CPU 限制）。
- 10/30/100 会话每日分别约 300/900/3,000 请求；计入保守 900-byte 票据后的网络流量约 0.72/2.16/7.21 MB。均落在本 receiver 5,000 批硬上限内；需同时检查 8 MiB JSON 预算、共享账户余量和实际请求分布。
- 每日 30 会话、七天 6,300 批，真实 SQLite（完整 schema/索引、真实长度合成 UUID/HMAC/commit）分配 32,362,496 bytes，约 30.9 MiB。没有保存真实账号；汇总表在此七天原始存储模型里为空，90 天汇总和 provider backup 占用必须另测。
- workerd/D1 实际接收了全部 30 批；D1 最后 COUNT 查询返回 size_after 176,128 bytes。`receiver.d1.meta.rows_read/rows_written` **只对应最后 COUNT 查询**，不代表全部 ingest/cleanup 计费量；不声称零写入。真实账户计费/CPU须隔离 Preview 后回读。
- `d1-cost.json`（复验源见 `d1-cost-source.ts.txt`；替换示例绝对 checkout 路径后用 `pnpm exec tsx` 运行）另行累计本地真实 D1 API 返回的每条 SQL meta：同样 30 批/150 事件，ingest reads 615 / writes 151；次日汇总 338 / 4；到期删除 124 / 30。这包含 handler 的查询/计数器与维护事务，不是 hosted 计费保证。SQL/索引与 provider 行计数差异必须在 Preview 复核。

自动回归保护：白名单拒绝与脱敏、ActionResult/抛错/BP stale 真实语义、operationId/requestId 关联、禁用与离线隔离、稳定批次重试、实际 SQLite 事务回滚/预算、同毫秒游标分页、七天读端到期与 500 批有界清理、无身份汇总、汇总写入/删除失败不回滚 raw 清理、关闭日期拒绝迟到事务、真实 Worker/D1 并发 ACK 去重；设备授权仍经过原 auth/业务 owner，成功后才导航。

会话安全 E2E 将退出登录与改密拆成独立撤销契约，并行建立两个独立登录，所有旧 Cookie 拒绝/另一会话存活或撤销/改密后登录断言保留。未加 timeout、retry 或 skip；三条原浏览器流程零重试通过（20.3s、20.7s、10.0s；总 wall 34.4s）。初次 CI 的合并用例 30s 超时，在原始 main `a1051ea7` 冷启动也复现，首个安全页加载约 11s；不用首次重试通过当完成证据。

本地命令：app/tests/scripts 类型检查、定向 Vitest、变更范围 ESLint、architecture:check、knip（含 production 检查）及 frozen-lockfile 安装。精确结果与远端 required checks 在 PR 中记录。ESLint 有既有 JSX TSNonNullExpression 解析提示，knip 有配置冗余提示，均不代表新功能错误。未部署、未配置持续凭据、未读取生产用户事件、未调整线上缓存。

保留/配置与上线审批边界见 [产品遥测运行手册](../../operations/product-telemetry.md)。应用七天 TTL 不代表 D1 Time Travel 副本绝对七天；全副本保留要求和九十天无身份汇总仍待确认。
