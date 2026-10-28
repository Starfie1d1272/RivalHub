# 公开 LIVE 上次画面验收

本地 disposable Supabase Auth / SQL / Realtime 与 Chromium 使用真实 viewer 查询、production ingest 和匿名 private Broadcast。停止 producer 后完整刷新，先确认新资格，再展示旧计分表；重新发帧后真实 LIVE 替代旧表。测试通过：1 passed（50.5 秒）。没有访问 hosted Supabase，也没有生产写入。

```sh
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 RIVALHUB_LIVE_EVIDENCE=1 RIVALHUB_LOCAL_SERVICE_PROFILE=auth PLAYWRIGHT_RETRIES=0 pnpm test:e2e tests/e2e/flows/public-match-live.spec.ts --project=chromium --workers=1 --reporter=list
```

[桌面 1280px](desktop-previous.png) 与 [窄屏 390px](narrow-previous.png) 使用合成测试赛公开资料。自审：显示「上次画面 · 等待实时数据」和原 UTC 收帧时间；没有运行时钟或雷达；窄屏内容无页面横向溢出，表格保留自身横向滚动。开发指示器不属于正式产品。截图不证明生产已上线、并发承载或真实 Mizar 接管；缓存边界和计时由确定性测试覆盖。

独立审查修正另以本地正式公开赛执行真实 Next Link「详情 → 赛程列表 → 详情 → 刷新」，列表行初始不可见不清 proof；同场仅一次 channel join，往返后持久化更晚合法帧，停止 producer 后刷新仍先取得新 viewer proof 再回显。退出统一经客户端 Auth helper，失败不清理；共享 receiver 五秒保留期的身份重置由确定性 transport 回归覆盖。

一次性截图和网络诊断采集入口已移除，现有测试继续验证实时画面与恢复流程。
