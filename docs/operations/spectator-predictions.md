# 观赛预测运营

Prediction 自由推演不需要管理员启用或登录；浏览器只保存当前内存中的选择和撤销，每次进入/刷新从官方赛果开始，未结束比赛默认高种子获胜。Play-in 复用 Qualification Short Swiss，不提供 Pick’Em；Main Event 只消费正式确认的名单与种子。推演不保存到数据库、不提供快照分享，也不写回比赛事实。

Pick’Em 不设独立管理员页面。Main Event 名单与赛事种子正式确认后自动开放首阶段；上一 Swiss 阶段正式确认后，使用 canonical 晋级与种子规则自动开放下一阶段，不等待管理员生成比赛。未确定名单显示等待状态；未排期时允许提交，截止显示待公布。阶段窗口冻结参赛队和种子，StageRun 生成后仅绑定相同名单；官方名单更正或运行记录恢复使原预测失效，保留已提交记录供查看。挑战总数由阶段数量及类型决定，纪念币门槛由固定政策计算。

截止只消费该阶段最早的正式比赛计划开赛时间；提前实际开赛立即锁定。尚未截止时排期调整可更新截止；已有截止或实际开赛记录永久锁定，延期不重开。官方排期/开赛变化在同一事务更新截止和锁；公开读取也按相同规则投影。没有 Pick’Em 暂停、手动作废或单独 deadline 操作。截止/失效后，无提交者仅隐藏预测单入口，赛事推演保留；提交者保留只读单。BET 通过独立入口与固定积分政策运行，不依赖 Pick’Em。运营规则见下文。

`/api/cron/reconcile-predictions` 使用现有 Cron 鉴权与统一 scheduler registry/execution/health，Supabase primary、GitHub watchdog 和管理员恢复共享同一个 runner。数据库 `prediction_reconciliation_is_due` 是待处理判断的唯一 owner，调度器、批处理与 mutation reconciliation 共用它，只有官方事实变更或未锁定窗口到期时才需要结算。公开读取不推进结算、不获取项目锁；到期窗口即时显示为关闭，积分和成就显示最近一次已提交的结算结果。批处理只选择这些事件，避免空闲事件占据批次。失败返回非成功状态并记录可重试错误；官方操作无需等待结算完成，待处理条件保留供重试。排查时比对官方比赛、轮次确认、阶段最终确认与 prediction settlement/ledger 历史；禁止手动改余额或删除流水。修复原因后重新运行同一 owner，幂等重试不会重复发放。

改判后已使用的返还形成待抵扣差额，可用余额为零；合法补给、退款及新结算优先抵扣。未结算投入不进入净收益榜。纪念币重算不触发积分奖励。

本地验证使用 `pnpm test:integration tests/integration/db/predictions.test.ts` 和 `pnpm test:e2e tests/e2e/flows/predictions.spec.ts`；需要真实服务时显式设置 `RIVALHUB_ALLOW_LOCAL_CONTAINERS=1`，只能通过 active Drizzle migration chain 初始化隔离测试库。发布按通用 release runbook 执行，Pick’Em 跟随官方阶段自动开放，自由推演无需启用。

Sanitized preview mirror 不复制观众的草稿、提交和积分账本，也不复制依赖它们的预测项目与窗口，独立 `bet_*` 项目、账户、盘口、投入、结算与流水也全部排除；公开的系列／单图开局事实按源迁移版本导出。预览库按 active migration chain 建表后，需用独立测试数据确认官方名单并形成阶段事实；不能把生产观众数据作为界面演示素材。


## 免费赛果与 BP 预测

免费预测不要求启用 BET 或领取钱包。正赛沿用 drafting/playing 阶段；Play-in 仅在 registration 阶段、比赛绑定本赛事已启动且未完成的资格运行时开放。读模型与提交共用同一资格生命周期判断，未启动、已完成、结束或归档赛事不可提交。赛果以实际对局开始为截止，BP 以 BP 开始为截止；持久化截止事实不会因恢复或清空 BP session 而重新开放。

## BET

`src/lib/bet/` 是新 BET 的唯一盘口、投入、积分和结算 owner。`bet_*` 表与 Pick’Em 项目独立；旧 `prediction_*` 金融表和兼容入口保留历史及 N/N+1 兼容，不被新 BET 页面或操作消费。管理员启用后自动生成满足条件的盘口，可暂停/恢复投入、永久提前锁盘、填写原因作废退款，官方更新待处理时可重试。后台以比赛／赛事盘摘要为入口，支持队伍、选手、地图或盘口搜索，以及状态、类别、阶段筛选；展开一组后查看奖池和参与人数，执行带目标信息的锁盘／原因退款。筛选与整组分页通过 URL 恢复。答案只来自官方事实；后台不提供赔率、选项、截止日期、答案或余额编辑。

固定政策提供初始积分和后续正赛阶段补给，具体数值由代码 policy 拥有。领取和补给幂等，阶段首次开放 milestone 在恢复重建后保留，晚加入者不领取历史补给。Pick’Em 不向 BET 钱包发放积分。管理员可按普通账户规则参与；当前 confirmed/frozen 名单成员仅禁止参与涉及本人队伍的盘口，赛事盘按其实际涵盖名单判断。首次账户必须显式领取，GET 不开户；reconciliation 从 canonical MajorStageRuns 补齐缺失 milestone，数据库严格比较 joinedAt < openedAt，启用顺序和重试不改变晚加入规则。排行榜仅计入当前有效已结算参与，按 ledger 净收益并列排名；同分依次按结算数、加入时间、账户稳定标识排序。记录视图只呈现本人流水，以自然语言解释补给、退款和官方更正，不公开内部标识。暂停不阻止自动结算，恢复不重开已锁盘口。

低保仅允许已加入本届 BET 的 active、邮箱已验证账户主动领取；原始账面余额为负时拒绝，不把 debt 当成零。余额不足目标时只补差额，受北京时间日一次和本届累计上限约束，具体金额由 `BET_RELIEF_POLICY` 拥有。累计只消费 relief grant，profit 固定为零；初始、阶段、退款及结算继续沿原账本规则。仅已启用且未暂停、未结束/归档的赛事可领。所有读取均不开户、不结算、不发积分。

钱包使用 `getBetRelief({seasonId})` 获取 `BetReliefDTO`：`day` 是数据库北京时间日键，`reason/canClaim/amount/granted/remaining` 表达当前资格与额度，积分以十进制字符串传输。本人明确点击后调用 `claimBetRelief({seasonId, day})`，不接受客户端 userId、amount 或历史日期；成功返回 `BetReliefClaimDTO` 的实际金额、是否重放和最新资格。钱包刷新两份快照时以 claim 重新验证的结果为准。跨零点旧 day 请求必须刷新，同日重放只返回原 receipt，不重复发放。规则说明放入原位小问号，默认只展示紧凑入口/状态，免费预测不依赖此操作。

claim 按 user → season lifecycle → BET program 的既有锁序取锁，在金融锁取得后使用数据库 wall clock 生成日键，再于同一事务计算 raw ledger balance、仅 relief 的累计、每日 source 幂等并追加 grant。该 program 锁与下注、结算、退款、更正及阶段补给共享。低保属于已有私有金融账本数据类别，按原 owner 的授权、长期审计及备份/恢复语义保留，不新增公开个人参与明细。

| 盘口 | 开放 | 永久锁盘 | 结算 |
| --- | --- | --- | --- |
| 冠军、赛事击杀王 | 正赛名单/种子确认，击杀王还需正式选手名单 | 正赛首场 BP 或对局实际开始 | 冠军正式确认；击杀王另需全部正赛正式地图的已确认 DAK 统计，并列共同获胜 |
| 比赛胜者、精确比分、总地图数 | 正式对阵与 BO 确定 | 实际对局开始 | 正式比赛结束 |
| BP 本场地图/首图/决胜图 | 对阵、地图池与 BP 格式确定 | BP 开始 | 完整 BP 无待处理申诉；决胜图无需实际进行 |
| 单图胜者 | BP 完成后的首图，或上一图正式结束且系列未决出胜者 | 本图实际开始 | 正式单图结果 |
| 单图总回合 | 正式对阵与 BO 确定，按本场地图序号开放全部可能地图 | 本图实际开始或系列赛确认胜场已决 | 正式单图结果；未打地图在正式终态退款 |

已确认地图胜场达到系列获胜阈值时，公开投影、投入校验和官方 outbox 即时锁住剩余图池；正式 match finished 延迟也不再允许投入，但不提前退款。比分更正不会重开已锁池，退款仍等待正式终态。

BO1 不生成重复的单图胜者；总回合仍独立开放。BO3/BO5 的单图胜者只按实际进行顺序开放；总回合赛前显示第1图至第3图/第5图，BP 后补地图名，不替换池或重新定线。总回合包含加时；创建时地图已知则以两队该地图近期正式样本优先，否则使用赛事历史，样本不足用 policy 基线。全部 line 在创建时冻结，不随 BP、奖池或排期变化。总回合的新 subject 绑定本场图序，地图 ID/名称是展示及结果定位事实；已有绑定地图 ID/名称的旧盘继续沿用原条款，同一对阵/运行/BO/图序不补重复盘，已锁或已结算历史不转换。官方对阵、运行身份或 BO 更正使旧 subject 作废，不复用旧池；在仍有合法开放窗口时生成新 identity。旧的地图身份盘仍按原有地图更正规则退款。

`matches.started_at` 继续表示原有 BP/赛务开始；`matches.gameplay_started_at` 和 `match_maps.started_at` 才是实际对局/地图的永久开始事实。通过完整校验的 Mizar 开图和管理员「确认本图已开局」共用 canonical map-start owner。人工路径必须在实际开图时确认；不能等录入比分才锁盘。已确认的地图开始或赛果也证明系列已经开始，即使独立开局标记缺失，仍同步锁定系列及赛事盘口。启用前已经进行且无法证明尚未实际开图的比赛不补开赛前窗口。浏览器时间和排期都不授权投入。

官方修改在同事务触发轻量 BET outbox，先取得 BET 项目锁再锁盘口，与 worker／管理操作保持同一顺序，并即时锁定受影响盘口；结算由既有 `reconcile-predictions` scheduler runner 同时运行独立 BET worker。结算器在同一事务内批量读取各盘口的结算输入，减少持有项目锁期间的数据库往返；最新结算版本按盘口独立选择，积分写入继续在锁内完成。失败保留 dirty 状态。BET 目录版本仅在 reconciliation 完整提交后推进；新目录尚未发布时，scheduler 和 worker 仍判断为待处理，即使旧程序在上线窗口已经清理 dirty 标记，也不会漏开现有赛事的合法新盘口。公开读只返回只读 snapshot 与个人记录，不开盘或结算。积分池为整数、无抽水，无胜方投入或全池获胜时退款；弃权/取消退款。结果更正先冲销上一次返还，再按最新官方事实结算。已使用的错误返还形成待抵扣差额；所有新收入优先抵扣。流水、选项、投入、结算和阶段补给事实不可编辑或删除。

验证入口为 `tests/integration/db/bet.test.ts` 与 `tests/e2e/flows/bet.spec.ts`，只使用隔离本地数据库与真实浏览器登录。

BET catalog 的 reader-first 发布门禁由 Release Plan 消费 candidate 与 frozen previous Production commit 的 `src/lib/bet/catalog-contract.json`。新增 subject 的 publisher version 不得超过 previous Production reader version；必须先独立发布兼容读取版本，再启用新 subject，不能把两阶段合并为一次发布。兼容 v1 publisher 遇到同图序的新池时不重复开池；兼容 v2 publisher 遇到同一比赛曾创建的 BO3 `veto_present` 时不补开首图/决胜图池，即使原池因对阵、run 或地图池更正而不再匹配 subject、已锁或已作废。它们与新 worker 复用同一金融结算 owner。

BO3 三图积分市场的兼容 reader 支持 `veto_present`：冻结七张不同地图的 match subject，每账户选择一张；完整合法 BP 的三张无序地图全部作为中奖选项，不依赖第三图实际进行。BET 与免费 BP 成绩共用 `src/lib/matches/veto-result.ts`，从已完成 session 的正式 `match_veto_steps` 依序投影 pick 与 decider；`match_maps` 只表达地图对局，不承担 BP 答案来源。BP 未完成、步骤或结果集合缺失/重复/不在冻结地图池或有待处理申诉时保持 pending；取消、弃权或 subject 更正沿现有规则退款。正式 BP 步骤更正追加 reversal/settlement，已锁盘不重开；仅地图顺序变化不改变中奖集合。选项支持率仍以该选项投入 / 全池投入计算，三张中奖图不会各分一个奖池。

BO3 publisher 只读取独立的 `capabilities.bo3BpPresence` publisher 开关；全局 catalog 或 ledger 升级不授权新市场。只在合法赛前窗口、冻结七张不同地图且本场从未创建任何 BP 市场时生成一个 `veto_present`。任何已创建的旧 BP 池（即使无人投入、已锁或已结算、官方身份后来更正）保留条款与入口，不转换、不补三图池；BO1/BO5 保持原逻辑。目录 generation 与追加 migration 中 `scheduler_job_is_due` 的 BET 版本门槛同步推进，旧 worker 清理 dirty 后仍会由新 worker 恢复待处理工作。页面显示七选一、逐选项资金支持率及实际返还；赛前不提供独胜收益估算，原位规则说明三张地图共用一个奖池和退款条件。

缺失能力声明的旧版本视为 0/0；Release Plan 对每个能力单独验证 frozen previous Production reader 与 candidate publisher，并禁止回退到不兼容 reader。BO3 reader1/publisher0 必须先独立上线 Production，再发布 publisher1；合 main 或一次混合发布不能替代这一步。追加目录 migration 仍按 Release Plan 完成 PG17 rehearsal、N/N+1 兼容与条件 checkpoint。

金融 ledger kind 使用独立 `ledger-contract.json` 维度，缺失声明视为 reader/publisher 0。ledger v1 reader 将 relief 显示为低保补给，未知 kind 显示为积分变动，余额/净收益继续消费 amount/profit。低保 producer 必须等待 ledger reader1/publisher0 独立上线后才能启用 publisher1；市场全局或 `bo3BpPresence` reader 的发布不授权新 ledger kind，低保 reader 也不授权新市场。

纯结算规则修复不会自动把已清理 dirty 的历史项目重新入队。部署后如需修复历史待结算盘，管理员使用原 BET「重试」操作，经既有项目锁与 reconciliation owner 重新读取正式事实；不直接修改答案、余额或地图记录。同项目重复执行不会重复返还。
