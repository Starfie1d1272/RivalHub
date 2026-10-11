# #911 统一竞猜 UI 浏览器验收

2026-10-11，真实 Chromium + 本地隔离 PostgreSQL + 正式 Server Actions。使用 `prediction-browser-*` 临时合成赛事、虚构 Browser 用户和测试队伍；测试完成清理，不读取或修改生产下注/积分。没有新增产品页面、替代生产 API 或执行生产迁移。

组合依赖：免费 owner `587e7c53`（含公开 status/isForfeit/restriction）；低保 owner `e66ca22a` 的正式 active 0086；UI PR #923。组合 worktree 仅供本地验证，依赖合 main 由父协调；catalog/ledger 发布门禁冲突不在 UI 分支处理。

命令：

```sh
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm db:local:migrate
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 RIVALHUB_BET_SCREENSHOTS=1 pnpm test:e2e -- --project=mobile-chrome flows/free-predictions.spec.ts --reporter=list --workers=1
```

最终 Action 流程通过（20.3 秒）：详情预测/BET空分母显示暂无而非50/50；BET停用时免费赛果/BP独立提交和取消改选；初始1000沿用原入口，ALL IN投入与免费选择不同队伍；余额0改选并确认正式读取；服务端GET不发低保，显式点击+10、同日刷新不重复、隔离账本只有一条amount10/profit0；BP与赛果各自官方开始信号拒绝缓存旧状态并回读锁定；完成后命中、取消后作废、本人历史保留；净收益/命中次数/命中率三排序同表三列。

缓存拒绝阶段仅暂停浏览器轮询时钟，让旧视图可重复复现；服务器Action和PG时钟保持真实。导航前恢复浏览器时钟。截图前等提交完成并回到页顶，只隐藏开发工具和短暂toast。

截图：`mobile-320.png`、`mobile-390.png`、`desktop-1440.png` 为稳定零余额、免费甲/BET乙的同场卡片；`ranking-320.png` 为低保领取后的真实排行和钱包状态。三种视口均验证document无横向溢出；窄排行三列直接可见。

配套证据：UI单测15/15（含旧poll不能覆盖fresh、新独立意图不复用历史requestId）；原BET真实浏览器通过；既有BET/历史兼容PG21/21；app/tests类型、定向lint和architecture通过。独立只读最终审查无新增P1/P2。BO3/5选择数与历史保留另经typed-fixture实际Chromium验证；未来多赢家/未知市场独胜收益估算显示—，publisher未在本线开启。
