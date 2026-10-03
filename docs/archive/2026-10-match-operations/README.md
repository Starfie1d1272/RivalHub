# PR #772 管理运营验收记录（2026-10-03）

这是隔离 PostgreSQL 17、本地 Next.js 与 Chromium 的 fixture 验证，不是生产或真实 CS2/Perfect/OBS 验收。源码与 active workflow docs 是当前实现 authority，本记录只保留本轮证据。

- AUTO / 无 Mizar MANUAL / 身份冲突 REVIEW / 显式 stale / POST 五种真实工作台路由，分别检查 1440、390、320px；没有页面横向溢出或 pageerror。
- 真实管理员 session、服务端鉴权、人工接管 action；接管后刷新、点击刷新、返回总览再后退，当前地图权限保持一致。
- 正式 map completed_at +11 分钟时显示软提醒，上一图 OCR 和下一图建房同时可用。
- PostgreSQL 回归覆盖 scoped takeover 重试、错误 epoch 拒绝、AUTO 拒绝人工结果、正式结果拒绝覆盖、迟到冲突保留正式赛果、下一图健康 re-arm；同时跑 DAK submit 与工作台 read model。
- 基础计分板回归覆盖缺字段、合法零值、重复/越界身份、错 match/map、整数/范围/回合约束；DAK gameplay/identity 锁定与 OCR enrichment 回归保留。
- Cross-repo fixture 通过真实 Mizar adapter/parser：`d2056d4d6a5bd2d54147e68099276ec412c4b710`。

截图：

- [自动观察](auto.png)
- [真实冲突优先处理](review.png)
- [普通人工赛务 · 320px](manual-320.png)
- [图间并行任务 · 390px](intermap-390.png)
- [三组赛后完成度 · 390px](post-390.png)

当前边界：本线没有实现公开 viewer / Radar 或 OBS 控制。source stale 只消费明确的 producer/source evidence，不用低频 reliable-event 时间推断网络断流；连续直播断流/reconnect 展示属于公开/实时专项。Bilibili provider 故障保持 unknown，不作为比赛 gate。#610/#613/#764 的跨产品现场 rehearsal、公开体验和各自其它未交付项仍须单独验收。
