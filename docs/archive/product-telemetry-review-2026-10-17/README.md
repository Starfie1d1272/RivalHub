# 遥测终审修正证据（2026-10-17）

本目录对应 PR #976 终审修正；替代 `dd20deff` 的未压缩 TEXT 存储量测。最终提交 SHA 及 CI 状态以 PR 为准，`source-sha256.txt` 固定本轮被测源码。所有数据均为本地合成，无生产数据/凭据/资源变更。

## 修正与针对性证据

- 移除“存在任意到期行即 503”的接收条件。小时维护每块独立提交 500 行、每轮最多 5,000 行；5,505 行集中到期测试证明首轮剩 505 行，接收继续；注入 DELETE 失败仍接收且读端不泄露过期行，解除故障后清完。后续汇总故障不回滚已提交 raw 删除。
- 原始数据实际保存为 gzip BLOB，查询每页二十批、有界解压；真实 workerd/D1 覆盖 BLOB 写读，SQLite 32 事件批次往返与分组次数/耗时守恒。没有第二份未压缩 events TEXT。七天同批 `summary` 只是无身份维度计数投影，仍随 raw 删除。
- 单票据改为滚动一小时 120 批（120 批突发仍限流），正常一分钟一批不会累计耗尽。客户端和接收端分别模拟 26 小时/1,560 批，只有一次约 20 小时续签，续签保持同一活跃诊断 session；后台续签不是用户操作。临时故障最多每小时重试，迟到响应不能恢复已退出账号。首次 Header 签发复用现有投影，续签调用一次同源、no-store 的独立 POST 读取当前授权，不写 Runtime Cache。
- 长期汇总默认不生成；`RETENTION_APPROVED=1` 不代替独立 `SUMMARY_RETENTION_DAYS`。缺省/0/非法值不写汇总；显式模拟配置才生成固定 expires，重跑/放大配置不延长已有行，关闭新生成仍清除已到期行。测试中的 2/14/90 天仅为边界输入，不是生产保留批准。
- 定向 Vitest 25 项：13 receiver、7 client、1 real workerd/D1、4 renewal API；类型检查覆盖 app/tests/scripts，变更文件 ESLint 和新增 续签 API 边界的 architecture check。未手动重跑无关 browser/PG/FULL 验证，未放宽 CI/超时/重试规则。

## 原始数据与代码大小分别量测

`measurement.json` 由 `pnpm telemetry:measure` 生成。每日 30 个半小时合成会话、七天 6,300 批，完整相同 schema/索引对照：

| 指标 | 结果 |
| --- | ---: |
| 原始事件 JSON（未压缩） | 8,926,680 bytes |
| 原始事件 gzip BLOB | 2,632,814 bytes（29.49%，缩小 70.51%） |
| 同批七天计数投影 JSON | 1,398,180 bytes |
| gzip 方案 SQLite 含全部索引分配 | 11,608,064 bytes（约 11.07 MiB） |
| 同 schema/索引但 raw 为未压缩 JSON 的对照 | 33,095,680 bytes |
| Node 原生 gzip 每批 wall p95 | 1.058 ms |
| 独立客户端核心脚本 gzip | 6,573 bytes（不是 raw 数据大小） |
| 客户端动作包装 p95 | 0.9 ms |
| 本地 workerd 接收完整 POST wall p95 | 27.76 ms（不是 Worker CPU） |

30 分钟仍为 150 事件/30 次 Worker 请求；26 小时持续活跃场景额外一次 Vercel 续签请求，故障情形最多每小时一次。30 个会话每日约 900 请求、2.16 MB 传输（票据按 900-byte 保守估算），网络仍是有界 JSON，不冒称传输也已 gzip。长期汇总表为空的存储模型不代表批准后的长期汇总容量。原始 JSON 字节预算不因压缩变小而放宽。

`d1-cost.json` 由同目录 `d1-cost-source.ts.txt`（替换 checkout 路径后用 tsx）累计真实本地 D1 API meta：30 批/150 事件 ingest reads/writes=586/181，汇总=218/7，删除=124/30。新 `(ticket,received)` 索引服务滚动限流。这是 Miniflare 本地计数，不能替代 hosted D1 对索引/删除的实际计费或共享账户余量；最后 COUNT 查询的零写入也不能当成总写入为零。

## 七天保留边界

七天是原始事件的读端 cutoff 和清理 eligibility。正常小时调度存在延迟，任务失败可更长；SQL 删行不证明 provider 存储介质和恢复副本同步物理擦除。D1 Time Travel 可以在删行后继续保留恢复历史约七天，所以约十四天加清理延迟不是严格上限，更不是“所有副本七天”。若所有副本必须七天消失，当前 D1 方案不能直接获批，需要先确认 provider 能力或替换存储。最终部署、凭据、raw/备份总保留与独立汇总天数继续交回确认。
