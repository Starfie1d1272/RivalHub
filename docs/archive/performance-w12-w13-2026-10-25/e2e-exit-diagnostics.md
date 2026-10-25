# #1111：通过摘要后的退出诊断

精确失败候选 `063f808a`，CI `40140698481`、browser-5 job `121011684221`。四项用例全部通过、无 retry/flaky，约 56.6 秒输出摘要；随后约 39.7 秒没有输出，外层预算终止 E2E body。timing artifact 的 timeout 前状态是 `exited=false / closed=false / exitCode=null`，剩余预算 97.457 秒。因此不能把“最外 leader 已 exit 0、仅 stdio 未 close”当作实证根因。

失败 artifact 中 HTML 的 embedded ZIP 完整且 CRC 正常，报告为 4 expected、0 unexpected、0 flaky；这不提供完成时间。最小健康探针在相同 watchdog/pnpm/WebServer/HTML 路径正常返回（约 10 秒）。本地完整分片加临时 reporter 阶段标记也未复现挂住，HTML onEnd 约 189ms、onExit 约 2ms 后返回；该轮有一个 Major 冷启动 flaky，不能冒称 CI 复现通过。目前不认定具体根因。

本次仅增加 CI 观察点，不改变任何业务断言、超时、forbid-flaky、退出状态或信号/清理规则：

- reporter 在 HTML 前后记录 onEnd/onExit，并记录 Playwright process.exit。
- local.ts 记录 Playwright start/return、fixture cleanup start/return 和 wrapper return。
- watchdog 在既有 onTimeout 证据中附加自有进程 PID/父 PID/进程组/状态/类别/stdio 类型。无 argv、环境变量、路径或业务数据。
- 固定阶段 JSONL 保存到失败 artifact，便于区别 HTML、CLI graceful exit、同步子命令返回和 fixture cleanup。阶段记录不用于判成功，原完整 gate 仍决定结果。

脚本类型、变更 lint、knip 两种模式及带观察点健康探针通过。新增真实子进程单测验证超时前采集 live topology，且不包含 synthetic argv/env sentinel。既有 detached-child 单测在本云 executor 的 PID 消失断言失败：未改基线与诊断版对照均已杀为 zombie (`Z`)、均按 124 失败；没有修改或跳过该正式断言。CI 继续运行完整测试。
