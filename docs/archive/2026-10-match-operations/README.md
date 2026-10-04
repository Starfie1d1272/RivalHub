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

## 异常恢复复审证据

针对 a86330fb 的复审，在同步 main #794 后补充真实可靠事件 → PostgreSQL → operator-context → 人工命令回归。错图结果产生持久 execution_conflict，后续正确事件保持 REVIEW；invalid start 不删除可信执行事实，空绑定只通过明确确认 BP 的第一张未完成地图恢复，session/epoch/顺序/正式结果校验与审计保留。另验证迟到旧 epoch 拒绝、下一图健康 re-arm、gameplay→stale→人工接管不再显示图间任务、无 Mizar 正常人工路径。26 个集成测试通过，70 条迁移与 112 表 access matrix 通过。

37 个定向与 61 个 affected 测试通过；组件验证恢复说明、二次确认及目标变化后的重新确认。app/tests 类型、文件级 lint、architecture 与 diff check 通过。共享 presentation-phase 实现不变，保留原覆盖并补齐 #792 的乱序地图/旧 observation/2:0 覆盖。上述截图仍是前轮 fixture 截图，不作为新增空绑定恢复 UI 的现场截图；本轮没有真实 CS2/OBS 验收。

### 同 epoch 的 generation 切换回归

真实 PostgreSQL 新增事件链：identity_mismatch → 人工接管 → source_generation_changed（epoch 不变）→ 空 currentMapId → map_ended → REVIEW → 显式恢复 → 人工正式赛果。修复前稳定失败于恢复入口为 null；修复后 27 个集成测试全部通过。保留 wrong session/epoch、跳图、未显式恢复的拒绝，重复恢复只写一次恢复审计；正式结果不可覆盖，旧 generation 事件仍拒绝。审计增加当前 generation 与原人工接管 epoch。43 个受影响测试通过；本轮无公开页面或协议变更。
