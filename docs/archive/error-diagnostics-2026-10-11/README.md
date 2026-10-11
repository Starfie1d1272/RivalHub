# 错误排查编号 UI 与安全自审

本地 Vite harness 直接渲染当前 StatsError / MatchDetailError / ErrorState，使用 synthetic error（20 位十进制 digest 或无 digest），加载项目 globals.css 与现有 Button/PageLayout；未连接生产、DB 或日志 sink。截图不是线上故障或双 sink 验收证明。

| 页面 | 有编号 | 无编号 |
| --- | --- | --- |
| 统计 / 1440 | [截图](1440-stats-digest.png) | [截图](1440-stats-missing.png) |
| 比赛 / 1440 | [截图](1440-match-digest.png) | [截图](1440-match-missing.png) |
| 统计 / 390 | [截图](390-stats-digest.png) | [截图](390-stats-missing.png) |
| 比赛 / 390 | [截图](390-match-digest.png) | [截图](390-match-missing.png) |
| 统计 / 320 | [截图](320-stats-digest.png) | [截图](320-stats-missing.png) |
| 比赛 / 320 | [截图](320-match-digest.png) | [截图](320-match-missing.png) |

自动浏览器核验：十二个场景无水平溢出、原始 cause 不进入 UI、有编号/无编号符合状态；按钮可键盘聚焦并由 Enter 调用既有恢复回调。视觉检查 320px 最长编号完整可读，提示换行正常；1440px 居中且保留现有宽度/gutter 与 danger 状态样式。React 自审：无新 effect/state/自动 retry，无 Client SDK/sink，直接 import 既有 primitives，无嵌套交互元素，route 保留 role=alert。用户先检查已提交结果，避免重复 mutation。

安全证据：十八项定向测试覆盖严格 digest 1–20 位 ASCII 十进制、保留原值、不转换/截断/自造、拒绝注入/Unicode/超长/数组/数字/恶意 getter；Next hook 同一 canonical event 保留 requestId 与 digest，安全 context 无原始 cause；两处 UI 不渲染 message，只在点击时恢复。existing exception redaction owner 未变。

只读时间定位：/teams content 先 await searchParams/getUserSession；getUserSession 先 await cookies()，再进入 directory 的 new Date() 与 invitation 计时。目录时间用于有效招募过滤，不能据此判定它是线上 minified shared chunk Date.now 故障。已有 Vercel deployment file-tree 查询成功，但返回 source/output tree 未包含所需 `_0u4od0njr53si._.js` 或 server source map；尚不能从 minified stack 精确归因，未修改时间读取。此前实际日志与编号为 Issue #571 comment 6110774872。

Better Stack read/query 未提供，不能核验 OTLP 交付、同事件双 sink 或告警；没有获取 ingest secret，也没有扩大日志权限或制造生产故障。PR 不关闭 #571。上线后仍需用自然真实客户端 digest + 时间/route 与服务端事件的 requestId 查询闭环，digest 是 error hash，不是唯一请求 ID。
