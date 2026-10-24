# W15 中间候选生产构建采集验证

本轮基于 main `67d279c55e703e23a2cfe7ec0a2d4b907fa79b22`，不是最终 BP/outbox/worker 混合验收。`evidence.json` 保留脱敏的逐页资源字节、实际 LCP candidate、CLS session-window、receiver 接受的真实 ready，以及同一应用进程的 acquire/SQL/hold/RSS/heap 窗口。未使用生产账号、生产业务写入或独立 CLI pool 冒充应用 pool。

## 实测

| 活动页 | 冷暖页面样本 | 接受 primary ready | acquire / SQL 增量 | SQL 失败 | 最大等待连接 |
| --- | --- | --- | --- | --- | --- |
| 1 | 2 | 2 | 17 / 58 | 0 | 0 |
| 10 | 20 | 20 | 242 / 433 | 0 | 13 |
| 20 | 40 | 40 | 477 / 803 | 0 | 31 |

所有业务页面 HTTP200、无 page error，62/62 footer 可滚动到达；桌面 1280×800，合成赛事包含32队。三档依次运行，cold/warm 仅表示新/复用浏览器 context；服务器缓存未控制为冷态。每 route 样本不足以作稳定 p95、生产容量或优化收益判断。队列出现不自动授权扩池；本轮未改 pool 上限、区域、Redis 或索引。

## ready 缺失的原因

此前开发通路采样 `/seasons`，该路由没有 ContentReady consumer，且启动环境未配置 product telemetry，bootstrap 为 null。改为 BET/统计/赛程的真实 consumer 并启用隔离 fixture 后，receiver 实际接受 ready。浏览器 page/context 请求监听还会漏掉离页后的 keepalive 批次，因此最终以真实 Worker 的 SQLite 回读为准，不能把监听空数组判成页面没发事件。没有硬编码 ready、没有绕过协议校验，也没有据此修改业务 marker。

## 外部脚本影响

原开发环境两个失败入口来自 Vercel Analytics/Speed Insights 的 debug scripts；独立 Chromium 探测均为 ERR_CERT_AUTHORITY_INVALID，使用已有 CA/proxy 配置的 urllib 则均200，提示浏览器与代理信任链存在差异。没有关闭 TLS 校验、忽略证书错误或修改系统信任设置。

生产模式下这两个 SDK 改请求 `/_vercel/insights/script.js`、`/_vercel/speed-insights/script.js`。本地 Linux 服务没有这些入口，三档窗口累计145次 script HTTP404；业务页面与自有 telemetry 仍正常，但 Vercel 指标不可用且产生多余请求。因此本次实现仅在既有 VERCEL=1 托管标识下渲染这两个 SDK。自有 ProductTelemetry、receiver-first gate 和隐私合同保持。

## 复现材料

相邻 `*.fixture.txt` 是本次测试 harness 的可审查源，`harness.fixture.patch.txt` 记录临时适配；它们不是生产路由或发布步骤。临时 route 只在显式测试 gate 和回环 Host 下响应，Next 只绑定127.0.0.1；gate off/非回环 Host 均实测404。页面真实创建的 pool 以弱引用登记到同一 Node process，以跨越 Next entrypoint 的模块实例边界。连续只读 snapshot 不增加 SQL。

本地先使用仓库锁定 pnpm 和 canonical Supabase fixture/migration 流程。通过 `tests/e2e/helpers/prediction-fixture.ts` 创建唯一合成赛事，在窗口前完成并在结束后用同一 canonical remover 清理。将 fixture source 保存到 `/workspace/perf-materials`，在独立临时 worktree 应用测试 patch；launcher 的 build 模式执行真实 next build，start 模式绑定回环服务与内存 SQLite receiver，并在内存生成短期 fixture 密钥。route config 指向该 fixture 的 BET open/settled、统计 overview/players、赛程；分别设置 activePages=1/10/20，sampler 顺序调用 collector 并采同进程 snapshot。保留实际 source commit、tree、patch/collector SHA256、构建输出及 exit status。禁止把临时 HTTP 适配带入生产；此通路不证明生产 HTTPS 或 Cloudflare 部署有效。

## 状态矩阵

- W01：有限 stage、版本/导航/ready/受控错误合同与真实 PG pool/client 观测已合入；本轮真实 signed collector→Worker/SQLite 的62个 ready 验证通过。BFCache 已有隔离浏览器证据；最终同树 prerender/hidden visibility 仍未关闭。
- W09：veto_step 严格白名单和 map_plan/legacy/unknown 宽失效合同已合入，真实 PG六组合回归通过。真实 receipt/outbox 已随后合入 main c0d49610；本报告采样时的67d279c5不含它们，最终 worker/锁完整依赖联合验证仍待候选冻结。
- W15：生产构建1/10/20页、资源/排队/内存采集通路已测；Vercel 脚本404构成有效小修依据。最终 source 的移动端/短页/真实 ready/总CLS及 BP/worker 混合、同条件 baseline 对比仍待完成。没有用代码合并冒充部署改善。
