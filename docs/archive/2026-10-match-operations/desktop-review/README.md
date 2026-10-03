# #772 桌面工作流复审（2026-10-04）

基线：PR 开放，起始 HEAD `1163c8e3`；合入 main `d0aa254b`（包含 #793/#795），保留原工作台和共享 `presentation-phase.ts`。本轮不改公开比赛页，不新增转播分配模型、持久化 phase 或实时链路。

所有图片为真实 Next 页面、Chromium、1920×1080 viewport 截图；长页面分屏滚动截取，没有用手机宽度或整页拼成长图。数据来自隔离 PostgreSQL 17，队伍、人员和比赛均为模拟数据。不同情景使用独立赛事；拍摄时仅将当前模拟赛事显示在导航，避免夹具赛事挤满导航。DAK 情景通过真实提交接口导入仓库测试 Demo evidence，Demo 内昵称仍为 Fixture Player。

## 建议先审这两页，再审页内操作

| 页面 / 入口 | 审查重点 | 截图 |
| --- | --- | --- |
| `/admin/[seasonSlug]/matches` 比赛总览 | 我的当前场、下一场、无人认领场次；点击进入同一工作台；是否把解说认领误称为负责全部赛务 | [总览](overview.png)、[认领后刷新](claim-persisted.png) |
| `/admin/[seasonSlug]/matches/[matchId]` 单场工作台 | 正常比赛状态和人的任务分开；主操作是否符合当前情况；手动操作能否理解后果 | [自动正常](auto.png)、[其他人认领](other.png)、[刷新反馈](auto-refreshed.png) |
| 同页：首发、BP 与赛程管理 | 双方实际首发、确认状态、BP 负责人、开赛窗口、排期与危险操作 | [赛前](scheduled.png)、[名单弹窗](roster-dialog.png)、[赛程](schedule-and-lineup.png)、[弃赛确认](forfeit-confirm.png) |
| 既有 Veto Room（关联导航，不重做） | 队伍 BP 负责人、先手、开始确认、计时、禁选与起始边 | [Veto Room](veto-room.png)、[BP 录入弹窗](bp-dialog.png)、[BP 未完](bp.png) |
| 同页：Perfect 建房指引 | 六项复制、所属赛事、地图、选边，与实际 BP 是否一致 | [完整指引](room-room.png)、[实际复制](perfect-copy.png) |
| 同页：异常与手动比分 | 本站事实、上报差异、核对步骤、确认、取消、刷新后的状态 | [错图](execution-steps.png)、[恢复确认](recovery-confirm.png)、[恢复后表单](recovery-manual-form.png)、[正式比分已保存](recovered-official-result.png) |
| 同页：计分板、Demo、解说与录像 | 官方完赛和资料完成分开；DAK 前后字段权限；只检查实际地图 | [2:0](post20.png)、[2:1](post21.png)、[基础完整板](scoreboard-complete.png)、[DAK 已同步](dak-synced.png)、[DAK 后编辑](dak-enrichment-only.png)、[Demo 待处理](dak-needs-attention.png)、[解说与录像](commentary-video.png)、[确认名单后](commentary-submitted.png) |
| 总览折叠区：Mizar 授权与 Demo 上传工具 | 既有设备授权／撤销与下载，不是新的人员分配或制作工作台 | [工具区](resources.png) |

## 正常工作流

1. 在总览找比赛。需要承担解说时认领；赛务管理员不需要为录比分强行认领解说。
2. 赛前核对两队首发、BP 负责人和排期，在既有 Veto Room 完成禁选与起始边。
3. 按本场地图计划建 Perfect 房间。轮次、比赛短描述、队伍 1、队伍 2、GOTV 线路 2 延迟 120、GOTV Password 1 是六项复制；其它项是操作指引。
4. 比赛进行时，健康 AUTO 显示「Map 1 · Ancient 进行中」，另列「你已认领本场解说」或实际解说姓名。不把认领推断成正在开播、正在解说或正在 OB；不显示“观察 Map 1”这种伪任务。
5. 没有 Mizar 时正常比赛，结束后展开手动比分表单，核对并录入。本次实际提交 13:9，刷新后正式记录仍保留：[无 Mizar 录分后](manual-official-result.png)。准备房间时录分表单默认收起，避免抢占建房指引的位置。
6. 图间从上一图正式结束时间计时。准备下一图与补前一图计分板可并行；10 分钟只提醒：[图间](intermap.png)、[下一图指引](intermap-room.png)。下一图开始后不继续催房。
7. 系列结束后分别检查正式赛果、实际地图的十一字段计分板／Demo、已登记解说的名单／录像。2:0 不产生 Map 3 待办；无实际地图的弃赛不要求 OCR 或 Demo：[弃赛](forfeit.png)。取消比赛不继续准备：[取消](cancelled.png)。

## 异常应该怎么处理

| 情况 | 页面能确认什么 | 处理顺序 / 限制 |
| --- | --- | --- |
| 比赛身份不一致 | 本站双方队伍；报告确实声明身份冲突。报告没有逐项差异 | 在 Mizar 核对赛事、对阵和实际采集比赛；不是猜测哪队有误。修正后重新核验；无法恢复且需结束本图时明确转手动。[截图](identity-steps.png) |
| 阵容不一致 | 本站双方首发可展开核对；当前报告没有错人明细 | 比对 Mizar 采集的十人和本站首发，先排除采集错房间；确有换人时按赛事规定确认并通过既有名单管理登记。[截图](lineup-steps.png) |
| 错图 / 错地图绑定 | 本站当前地图、上报地图名称、上报所绑定地图、候选比分 | 检查是否采了另一场或上一图，不把正式地图计划改成错误上报。必要时显式转手动；已知当前 execution 保留。[截图](execution-steps.png) |
| 正式赛果与上报冲突 | 正式比分和候选比分并列 | 对照 Perfect 最终结果。正式比分正确则修复来源；正式比分确错时记录差异并联系赛事管理员，暂勿继续录后续比分。现有逐图更正仅限已结束系列赛，且不能改变系列赛胜者；进行中的更正工作流仍缺失，不靠接管覆盖。[截图](result-steps.png) |
| 明确失鲜 | Producer 明确报告没有新鲜数据；不是身份冲突 | 检查 Mizar 与游戏采集；不能用低频事件的时间间隔判断断流。需录分时明确转手动。[截图](stale.png) |
| 当前地图为空 / 连续性无法确认 | 不猜当前图；仅提供正式 BP 中第一张未完成地图作为恢复候选 | 明确确认指定地图后恢复手动录分。服务器仍检查 session、epoch、BP、地图顺序与已完成保护；不要求撤销整台 installation。[截图](unbound-steps.png) |
| 设备来源冲突 | Source authority 与比分录入是不同操作 | 用 Mizar 的设备来源切换处理；工作台手动录分按钮不切换设备。此原因说明已补，独立设备冲突未新增浏览器 fixture。 |
| Demo 错图 / 身份 / 比分无法对应 | 保留正式比分和已确认 Demo，显示 needs_attention | 在下方 Demo 待处理区核对，在 Uploader 重新选择正确地图并生成／同步证据；不把 OCR 当作修复 DAK gameplay 的入口。[截图](dak-needs-attention.png) |
| 赛事阶段、轮次或选边缺失 | 明确缺失，不猜测且不允许复制缺失值 | 修复赛程配置或 BP。只有此异常夹具故意保留缺失：[截图](missing.png)。 |

「改为手动录入本图比分」先解释后确认：本图停止自动写入，出现手动表单；迟到自动结果不覆盖正式结果，下一图核验通过才恢复自动。它不操作 HUD、OBS、开播或 Mizar 设备，也不会解除网站实时数据的身份／阵容校验。确认目标发生变化时重新确认。

## Perfect 字段的来源

- 轮次：赛事阶段名；Major 为 Stage1/2/3；资格赛使用真实资格赛格式。修复 Direct BO3 Play-in 被错误要求 Swiss 战绩的问题。
- 比赛短描述：普通对阵用「第 N 轮」，淘汰赛用四分之一决赛／半决赛／决赛等，本轮 Swiss 用该轮赛前战绩。不是根据当前比分倒推。
- 队伍 1/2：比赛 A/B 的正式参赛队名，换边后不互换。
- 选边方式：本张地图 BP 记录的 Team 1 起始边；示例 Map 1 为 TEAM 1 CT / TEAM 2 T，Map 2 为 TEAM 1 T / TEAM 2 CT。
- 「比赛归属」是 Perfect 建房字段，要求选择本届赛事，并非 RivalHub 新建的“归属”概念。“赛务验收”是此前测试赛事名，已不用它展示正常情景。

## 本轮验证与仍需审查的地方

- 18 种初始桌面情景，检查无页面横向溢出和 pageerror；另补操作与赛后细分截图。
- 实际点击：刷新及完成反馈、总览返回、恢复取消／确认／刷新、手动正式录分与数据库持久化、六项剪贴板内容、解说认领后刷新、解说名单提交、名单／BP 弹窗与 Veto 导航。
- PostgreSQL 17：45 项 Mizar ingest + main LIVE capacity 回归通过；补充当前 session/epoch 的上报证据读取后再次运行 ingest 27 项通过。保留 main 的三连接池并发测试，并适配严格接管参数与明确失鲜前置事实。既有 generation 恢复、迟到事件、下一图 re-arm、无 Mizar 路径均保留。
- CI 发现 main 的 Demo egress 测试使用非 UUID 的管理员占位符；改用已创建的 fixture 用户，保持真实权限查询及 payload 读取边界断言，单独 PostgreSQL 复验通过。
- 定向单元／组件 42 项通过，另有 workbench loader/page 6 项；app/tests 类型检查与文件级 ESLint 通过。最终交付状态以 PR 最新 HEAD required CI 为准。
- 单独自查：未修改来源锁与 LIVE ingress；共享 phase 仍单一实现；admin evidence 只在赛季授权后读取并投影白名单字段，没有进入公开 DTO；正式赛果与 DAK ownership 未放宽。
- **进行中系列赛的已完成地图更正仍缺失。** 现有 `correctMapScore` 只接受已结束比赛，且拒绝改变胜者；本轮没有放宽这个正式赛果边界。遇到本站正式比分本身错误，仍需赛事管理员处理，不应继续录分制造错误完赛。页面已撤掉不存在的操作指引。
- **仍缺少身份／阵容逐项上报证据。** 当前页面诚实说明“未提供具体差异”，并给核对入口；要做到直接标红哪名玩家不同，需要补生产端报告契约和持久证据，再做跨产品验收。
- **仍需真实现场验证** Mizar/HUD/OBS、Perfect 建房、OCR 外部识别、B 站实际开播变化、Uploader 桌面下载与真实 Demo。这里没有启动真实 CS2 或向外部直播平台写入。
- **仍需产品审阅**：异常文字密度、首发确认与 BP 负责人入口、复杂赛后的表格滚动、Veto Room 在开赛窗口前的提示。截图只是让这些问题可具体审查，不等于整个 #610/#613/#764 已完成。
- 本轮只使用 1920×1080；以前的 320/390px 验证属于前轮证据，不冒充本轮桌面改动后的移动验收。
