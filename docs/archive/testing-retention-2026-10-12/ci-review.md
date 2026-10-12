# CI wall time 的精确拆分和启动清理

[ci-before.json](./ci-before.json) 来自 GitHub attempt-specific Jobs API 的 created_at/started_at/completed_at 及 step metadata，预算秒数来自失败 gate log。未读取成功 job 全量日志。关联 [run 38280961350](https://github.com/Starfie1d1272/RivalHub/actions/runs/38280961350)，原 head `2d89de06`。

| 时间部分 | attempt 1 | attempt 2 |
| --- | ---: | ---: |
| run_started_at → plan job created_at | 89 s | 2 s |
| plan created → started（排队/runner provision） | 2 s | 2 s |
| plan 执行 | 8 s | 6 s |
| 最晚结束 job | production | LIVE |
| 该 job created → started（排队/provision） | 3 s | 43 s |
| 该 job 执行（含所有 steps/收尾） | 146 s | 127 s |
| 其中缓存恢复 + pnpm setup | 10 s | 12 s |
| 其中 Supabase startup | 54 s | 46 s |
| 其中 migration/seed bootstrap | 6 s | 6 s |
| 其中 chrome --version 诊断 | 6 s | 2 s |
| 其中实际 browser wrapper | 56 s | 49 s |
| gate 检测时的总 wall time | **257.118 s** | **191.556 s** |

各行不是全部互斥区间，不能直接相加；JSON 保留完整 steps。browser wrapper 包含 Next 启动/编译、Auth/DB fixture、测试和 cleanup，不能叫作纯测试断言时间。attempt 1 的 89 秒在 plan job 创建前，不能精确断言全部是 runner 排队；它是 workflow 调度/concurrency 等待的可观测空档。attempt 2 LIVE 创建后有 43 秒待启动，metadata 不能进一步区分排队与 runner provision。

## 本仓可修复的冗余

- FULL 原三条小 unit lane 各自占 runner、checkout、restore、install。改为一个 unit-all runner，仍分别执行三个 Vitest project（不合并测试 `it`），分别记录 project evidence、默认无测试失败、累计 error/signal/nonzero，且保留 React retry-pass→失败 guard。affected planner 仍按原 project 与 explicit/related 选择。FULL static 5 → 3 个 runner，全部实际 unit/build/checks 继续执行。
- 删除 system 的 `google-chrome --version` 诊断：实际 core/production browser 仍以 chrome channel 启动真实 Chromium，启动失败会失败；provider API lane 本不需要浏览器。命令没有业务/安全 oracle，原只返回版本文本。没有删除 browser/provider 验证、健康检查或固定时龄负路径，没有缓存数据库或 Docker image tar。
- 不改变 workflow concurrency 取消规则、required dependencies、180 s 含排队起点、unit/browser retry 和 timeout。不是改计时起点、忽略失败或只重跑 gate。

本地 actual unit-all 确认三个独立 project 37/59/4 全部成功、flaky guard 成功；临时注入第一项非零和第二项 throw 后仍执行全部 project、聚合失败；FULL planner 临时断言 static checks/unit-all/build 与既有两片 PG、十片 system evidence 不缺失。未为这些临时验证增加长期测试。

## 无权限直接改变的部分

GitHub hosted runner 可用性、账号并发额度及 plan job 创建前的 workflow 等待不是本仓脚本能控制的资源。当前没有更改 account/org settings、购买 runner 或排除排队的授权。本仓减少冗余 runner 请求，只能用新 head 实际 CI 证明结果，不能承诺消除所有托管排队。Supabase startup 使用既有官方 slim 镜像和 CLI health check，metadata 不能把下载/init/health-check 等细项全部拆开，不能据此删除 readiness。

后续新 head 的准确 CI 结果记在 PR，保留上述两次失败，不反复赌重跑。
