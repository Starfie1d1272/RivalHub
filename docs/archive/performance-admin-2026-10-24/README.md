# W10/W11 后台读取实验快照

基线是已包含 #1081 的 `4ebecf5d5e1b629371c7d0c8851b6bab9c31d7f8`。未部署；这些实验不证明生产 LCP、CLS、核心可操作时间或混合负载下的 pool wait 已达预算。

35 个真实后台 page 入口逐项记录于 [route-status.json](./route-status.json)。状态保留已实现局部、被源码否定的具体假设及待执行的具体实验和 owner；不能把“没有访问样本”当作完成。

## 配对读取实验

隔离 loopback PostgreSQL，保留 active migrations 和真实约束，附加 1000 名用户、1000 条邀请码；Major 摘要 fixture 没有 entrants，不代表真实冻结名单规模。每个 reader 先比较可观察 DTO，然后交错 A/B 10 轮，未注入 RTT。原始数值在 [read-cost.json](./read-cost.json)，只保存 fixture 规模和数值，不含用户、邀请码、SQL参数或原始生产证据。

| reader | SQL 次数 before → after | 返回行 before → after | 结果 JSON bytes before → after | 本地 p50 ms before → after | 本地 p95 ms before → after |
| --- | --- | --- | --- | --- | --- |
| operations | 13 → 11 | 1005 → 7 | 69053 → 161 | 7.727 → 6.308 | 9.931 → 11.716 |
| invites | 2 → 2 | 1001 → 26 | 148011 → 3818 | 6.181 → 2.089 | 14.552 → 5.824 |
| Major summary | 14 → 9 | 4 → 5 | 346 → 345 | 5.593 → 3.835 | 8.365 → 5.136 |

返回行/JSON bytes 是 PostgreSQL 驱动结果的计数/再序列化大小，不是压缩传输、RSC bytes 或数据库 wire bytes。N=10 的 nearest-rank p95 即最大值；operations 尾部没有证明改善。Major 空名单实验主要证实少 5 条查询，不能推断已减少多少真实名单 payload。邀请码越界页仍可能执行一次纠正页查询，正常页 count/page 并行。

复现：

```bash
source /workspace/.onboarding/activate.sh
git show 4ebecf5d:src/lib/admin/platform-operations/overview.ts > src/lib/admin/platform-operations/overview-baseline.ts
git show 4ebecf5d:src/lib/admin/season-workspace/overview.ts > src/lib/admin/season-workspace/overview-baseline.ts
git show 4ebecf5d:src/lib/admin/invites.ts > src/lib/admin/invites-baseline.ts
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 RIVALHUB_ADMIN_READ_BENCHMARK=1 \
  RIVALHUB_ADMIN_BENCHMARK_OUTPUT=/tmp/admin-read-cost.json \
  pnpm test:integration -- tests/integration/db/admin-read-cost.benchmark.test.ts
rm src/lib/admin/platform-operations/overview-baseline.ts src/lib/admin/season-workspace/overview-baseline.ts src/lib/admin/invites-baseline.ts
```

基线模块为临时文件，禁止提交；可选 benchmark 默认跳过。真实 PostgreSQL 约束、生命周期、时区和权限的定向 correctness suite 不依赖这些临时文件。

## 已有验证与限制

- `pnpm type-check:app`、`pnpm type-check:tests`、受影响文件 ESLint、`pnpm architecture:check`。
- 真实 PostgreSQL：后台 match、审计、Demo egress、运营聚合、邀请码筛选/分页、用户参与筛选，覆盖 canonical scope、fallback、DTO隐私、历史事件、CST午夜、认证去重、expiry==now、NULL排序、clamp。
- React/领域定向测试：OCR关闭不读取、激活保草稿；审计新 RSC props不触发第二套action；遥测旧会话结果隔离、快速选择合批、空指标防线；后台返回上下文。
- 仍需隔离浏览器/真实规模确认辅助provider延迟、primary-ready/CLS、100/500场列表、30种audit target、混合负载；Steam批量补充已移到事务外，但尚无provider等待与tx-span的真实对照记录。
- 历史5次遥测客户端异常没有stack，错误边界与空数组防线不能据此宣称根因已关闭。single-flight与安全错误fingerprint由观测owner统一，不在UI复制。
- 资格/current revision、OCR写入/initial协议、公告与public-info的summary/detail、BET snapshot由各canonical owner协调后接入；本分支没有复制这些领域规则。
