# 公开 LIVE 上次画面验收

本地 disposable Supabase Auth / SQL / Realtime 与 Chromium 使用真实 viewer 查询、production ingest 和匿名 private Broadcast。停止 producer 后完整刷新，先确认新资格，再展示旧计分表；重新发帧后真实 LIVE 替代旧表。测试通过：1 passed（50.5 秒）。没有访问 hosted Supabase，也没有生产写入。

```sh
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 RIVALHUB_LIVE_EVIDENCE=1 RIVALHUB_LOCAL_SERVICE_PROFILE=auth RIVALHUB_LIVE_SCREENSHOTS_DIR=$PWD/docs/archive/live-previous-view-2026-10-11 PLAYWRIGHT_RETRIES=0 pnpm test:e2e tests/e2e/flows/public-match-live.spec.ts --project=chromium --workers=1 --reporter=list
```

[桌面 1280px](desktop-previous.png) 与 [窄屏 390px](narrow-previous.png) 使用合成测试赛公开资料。自审：显示「上次画面 · 等待实时数据」和原 UTC 收帧时间；没有运行时钟或雷达；窄屏内容无页面横向溢出，表格保留自身横向滚动。开发指示器不属于正式产品。截图不证明生产已上线、并发承载或真实 Mizar 接管；缓存边界和计时由确定性测试覆盖。
