# #729 审查证据（2026-10-05，Asia/Shanghai）

这是一份交付时的历史证据，不是当前产品规格或生产容量保证。初版规格为 Issue #729 的2026-10-04正文；本次根据用户提供的 PR `0b59ddfe` delta 修订（8条规则、概率样本 gate v2）。基线为 `main@7db01e6717e862095d6efc0b882c9bba340f1957`。未沿用历史评论中的单赛事入口、holder 或模糊 Insight 规则。保留 #779 的版本化投影与既有失效入口、#790 的 qualification/benchmark owner，以及 main 上的赛事 Logo #797；不覆盖 #764 等独立分支。

## 字段与实际包核对

安装锁定 `@cs2dak/tournament@1.1.1`。使用公开 collect/finalize/remap/scope API；`Projection.data` 保持 opaque。以下字段的名称指 canonical DAK 输出；逐图 finalize 仅在服务器发生。

| 能力 | 实际可用事实 | grain / 分母 | 缺失与投影处理 |
| --- | --- | --- | --- |
| 4v5、5v4 | tournament `teamConversions.manAdvantage` | team-round，wins/opportunities | 每项独立机会数；不重算人数转换 |
| Pistol、R2 conversion、break | `teamConversions.pistol/round2` | 各自 wins/opportunities | 不用同一个分母代替三项 |
| Win after FD | finalized `opening.roundWinsAfterLosingOpeningDuel` / `firstDeaths` | player-round，队伍最终赢回合 | 选手是首死对象，队伍是胜负主体 |
| Traded FD% | finalized `trade.tradedOpeningDeaths` / `opening.firstDeaths` | 首死次数 | 只补缺失展示比值，复用 cumulative facts |
| E/F、Net/F、T/F | finalized utility `enemyBlindSeconds` / `teamBlindSeconds` / `flashesThrown` | 秒 / 颗；累计分子除累计分母 | 负 Net 保留；F=0 不可计算；逐图事实支持固定 baseline 的 LOO；不套 Wilson |
| map Kills/ADR/FK/Trade | finalized per-map combat/opening/trade | 完整地图；ADR=damage/rounds | 仅保存每图局部最大值及精确并列候选 |
| Largest Clutch Won | Evidence `semanticFacts.playerRounds.clutch.{won,opponentCount}`、`roundSeq` | 实际 player-round | 原投影丢失 roundSeq，新增紧凑候选；不以最后存活人数猜 1vN |
| Economy Upset | nullable `playerRounds.equipmentValue` + canonical winner | 全员 10 人，team-round；败方和减胜方和 >0 | 任意未知值抑制该回合；仅允许经发布源码确认的 exporter；不保存完整原始回合 |
| 跨赛事身份 | userId；显式 entry.teamId；否则独立 entryId | player / team / event-entry | 不按昵称或队名合并；同图两边映射同实体失败；Overall 保留 entry 集合供展示筛选 |

ADR/HS%/Rating/RWS/WE 的聚合继续使用既有 SQL/aggregate owner：ADR 按已知回合加权、HS% 按击杀加权、后三项按已知地图简单均值。没有另写统计公式。

装备取样链核对的是已发布源码：cs2-demo-format `v3.1.0` peeled commit `0e3e6c712abfbefde40e47192fbe0f4112b5b522` 的 `parse.py` 从 `round_freeze_end` tick 读取 `current_equip_value`，`events.py` 的 economy join 使用同一 tick；DAK core `@cs2dak/core@2.0.2` 和 upload `v0.8.4` 将该值保留到 Evidence。当前仅识别 `exporterVersion=cs2df/3.1.0`，其它版本抑制装备纪录。版本从 adapter/1 升到 `dak-tournament/1.1.1:performance/1:adapter/2:records/1`，需要既有 protected backfill/coverage/release gate；本 PR 不运行生产 backfill。

## scope / 缓存边界

`/stats` 默认全部公开赛事，包含 archived；仅支持 all 或单 event。stage 仅在单届使用 canonical key，format 限 BO1/3/5，历史地图来自实际地图计划与Veto记录，而非现地图池；未完成与veto-only地图同样可访问，不生成不存在的统计。非法、未知或 draft 范围进入不可用页，不退回全范围。map detail 与 mapFilter 不得冲突。Veto、Teams、Map、Insights和装备纪录消费同一teamLinks：all-events显式teamId链接长期Team，单届始终链接本届entry。六个 tab 共用 href/parser；换 tab 保留兼容范围、清详情；换 event 清 stage/entry/详情、保留仍存在地图。

fresh public IDs 在 remote cache 外读取并进入 key；共享 `PUBLIC_STATS_TAG`，key 包含投影/规则版本。聚合内部再读 public membership。entity/search 只改变展示，不改变 qualification 总体。公开查询只读 metadata 和有效版本化投影；SQL logger 回归证明不选择 `match_demo_imports.payload`。Records分页在共享aggregate后的紧凑最大值并列集合切片，不再以recordPage创建完整聚合cache variant；全并列集合只留服务器。DTO 仅传所选视图的汇总与紧凑纪录，移除分析 provenance；不传 Evidence、roundSeq 数组或 LOO 地图事实。投影过期/撤回降低 coverage，不从公开请求 repair。本地生产模式先热读两届范围，再将其中一届的隔离fixture改为draft：原单届链接进入不可用页，全站summary立即为1场/1图/22回合；恢复公开后重新纳入。这验证fresh membership，不代替托管跨实例tag验收。

`/stats` slug 与其它静态入口预留；新增和更新校验、发布锁内校验、只读 coverage 的 route conflict gate 都已接入。现有冲突不会被自动改名。

## 规则命中与抑制

概率规则版本为 `INSIGHT_RULES_VERSION=2`。排行榜继续使用 canonical P75×25% 向上取整资格线和midrank benchmark；叙述的独立样本线为max(4,ceil(P75(sample)×50%))。Ready要求排行榜合格、合格总体N≥4、n≥叙述样本线；High要求P≥75%，比其它**排行榜合格**对象的Σx/Σn高至少5pp，且显示精度可区分。低于叙述样本线的排行榜合格peer仍参与累计参照，不把比较总体重建为只剩Ready对象。没有Wilson或统计区间 gate；这些条件不构成显著性或因果结论。Flash仍沿用固定基线LOO与原资格线，不套概率样本规则。

| rule | 命中测试输入 | 抑制/去重案例 |
| --- | --- | --- |
| four_v_five_resilience | 90/100，peer 合计20%，P=.875 | N=3、全体并列、n=0、1/1、2/2、3/3；n24不满足排行榜floor25；n25虽可排名但不满足叙述floor50；n50可展示 |
| advantage_disadvantage_inversion | 4v5 High；5v4=10/100，Ready且低分位；P差≥.35 | 次项2次机会/不同 coverage 抑制；命中后替代 simple 4v5 |
| opening_death_resilience | 90/100；真实 sanitized fixture 为6/6，N=8、P=.9375、peer≈.1053 | 首死 n=0、低资格或显示精度不可区分抑制；文案说明队伍赢回合 |
| opening_death_traded | 90/100；与 Win after FD 同族 | 同实体同族只保留1条，按P、L-peer、n、稳定 key 排序 |
| opening_loss_recovery_profile | Win after FD与Traded FD同时High，n与coverage一致 | 组合替代两条单项；两项分别累计首死被补枪次数和队伍取胜回合，共用首死分母；回合交集以逐回合记录为依据，解释可展开 |
| flash_effectiveness | 2张有 F 的贡献图；E/F和Net/F高、T/F低；每图删除均稳定 | 单图、599/1尖峰、未知T、高队友致盲、删除后不达原floor/中位数抑制；全体T=0可用精确0分支；E/Net与中位数在显示精度下不可区分时抑制 |
| pistol_conversion_contrast | pistol90/100 High、conversion10/100 Ready且P差≥.35 | 次项缺资格/窄样本/不同覆盖抑制；保留独立分母 |
| second_round_recovery | break90/100 High、pistol10/100 Ready且P差≥.35 | 回击机会缺失/低样本抑制；不声称故意输手枪有利 |

4/4和3/4使用相同的样本成熟条件：总体P75=4时两者均Ready；其它peer为0时两者均可High。n=1/2/3均不展示；rate-peer=4pp抑制、≥5pp可展示。四个 family 轮转，总数≤6；每实体≤2，每实体每族≤1。六类 Records 测试覆盖完整 normal/overtime map、整数与精确有理数并列、同 holder 多 occurrence、空态、24 次并列的有界分页、未知/未验证装备。来源保留赛事、实际对手、地图、比分、Rn 与有效实体/Match 链接。

## 验证与性能

定向统计、组件、profile 回归 33 文件 / 134 tests；后续长文本/合并选手筛选组件回归通过；本轮delta最终定向13文件81项通过，追加Opening组合展示与逐回合依据说明组件回归通过。应用、tests、scripts 类型及改动文件 lint、architecture 均通过。真实 PostgreSQL 17 回归通过，校验两届10个 canonical user、同名不合并、显式 teamId 合并、archived纳入/draft排除、DAK聚合一致性、新投影与repair/coverage、无 raw payload 读取。浮点累计比较保留12位有效数，避免不同SQL地图顺序的最后二进制位噪声。

浏览器回归使用真实 Local Supabase，Chromium 和 mobile-chrome 均通过，重试为0：六视图、旧入口永久迁移的实际客户端导航、无循环、键盘选择、Escape焦点返回、all-public Veto真实点击、veto-only与未完成计划地图详情、未知范围不可用与320/390/1440px无页面横向溢出。追加地图详情→标签/换赛事范围保持、纪录分页重置及浏览器前进后退回归。1024px两列未增加表格横向滚动（960px表格内容与容器同宽），次要身份列沿用断点隐藏。另在 `next build` / `next start` 的本地生产模式检查含数据的两列、六类 Records、Overview及展开解释、0/2/20/100赛事与长名称。截图的数据是仓库 sanitized normal-map fixture 的隔离合成身份绑定，不是今日真实比赛或生产 holder；100赛事测试中98届是无比赛的列表负载样本。

| 隔离两届 / 两图 / 十用户 | 逐届现有查询组合 baseline | 平台批量聚合 |
| --- | ---: | ---: |
| 查询数（含事务） | 30 | 17 |
| 完整 server DTO JSON bytes | 320955 | 197580 |
| 本地单次无 application cache耗时 | 44.20ms | 32.44ms |
| 第二次查询（温热DB buffer，无 application cache） | 未重复baseline | 17queries /31.74ms |
| 两图投影 facts::text bytes | 合计同样两图 | 86694（估计JSON体积，非wire账单） |

baseline 是**同一fixture的逐届查询组合**，不是虚构一个旧版全站 API，也不是完整生产before/after。计数不随用户逐个增长；不据此推断大历史规模。真实托管查询计费、跨实例 remote-cache hit/miss、容量上限及失效流量未验收。

[本地生产模式 HTTP 数据](local-http.json)：新进程、100公开赛事（98为空）、2图。临时本地计数器覆盖 pg Client 的事务查询，仅记录计数和结果JSON估算字节，不记录SQL/参数/内容；未加入产品代码。包含Header/PPR与fresh membership查询。

| HTTP视图 / 请求 | 查询数 | DB结果JSON估算bytes | HTML/RSC合并bytes | 耗时 |
| --- | ---: | ---: | ---: | ---: |
| Overview 冷进程 | 23 | 156829 | 233335 | 527.50ms |
| Overview 重复 | 6 | 46245 | 233249 | 53.34ms |
| Players 共享聚合已请求 / 重复 | 4 / 4 | 30830 / 30830 | 336603 / 336603 | 52.59 / 52.48ms |
| Records 共享聚合已请求 / 重复 | 4 / 3 | 30830 / 30724 | 144619 / 144576 | 47.61 / 31.28ms |

没有把HTML bytes混作DTO或投影wire bytes。DB结果JSON是本地估算，不是wire/计费量；Node默认cache行为不等于托管remote-cache命中率。

最终浏览器复跑前，视觉样本的Steam ID与E2E固定ID碰撞，建数阶段中止；清除隔离样本的Steam占用后，两浏览器重试0复跑通过。

本地 Supabase slim image 的健康检查曾因回环 wget 走代理而失败；Auth `/health` 实际可用。浏览器使用其真实端点；数据库证据另用独立回环PG17。该环境差异不作为生产服务健康的证据。

## 250-map容量实验（本轮review）

使用同一隔离Local Supabase，通过canonical materializer把sanitized normal-map Evidence绑定到248个独立match/map，加原2图共250个当前版本有效投影、10个重复参赛身份；另有1个retired-version投影未参与公开读取。该样本用于衡量重复阵容、同一Demo大小下的250图容量；多阵容与不同Demo大小分布交由生产验收。补入1张未完成计划和1张veto-only地图。造数不在公开请求进行。

[aggregate数据](capacity-aggregate.json)、[HTTP/RSC数据](capacity-http.json)。单次uncached聚合17queries，250当前投影facts::text估算10,845,994B；缓存内部aggregate 1,366,684B（含全部紧凑并列集合），Overview public DTO 72,522B。HTTP直接请求`RSC:1`并核对text/x-component；查询计数包含Header/PPR和fresh membership，不与核心17queries混作一项。

| all-public请求 | 查询数 | 投影行 / JSON估算 | RSC bytes | 延迟 |
| --- | ---: | ---: | ---: | ---: |
| cold aggregate（先清本地tag） | 25 | 250 / 9,618,994B | 125844 | 3581.00ms |
| warm重复 | 8 | 0 / 0B | 125844 | 66.15ms |
| PUBLIC_STATS_TAG失效后cold | 24 | 250 / 9,618,994B | 125844 | 3369.20ms |
| Records第1页，共享aggregate | 6 | 0 / 0B | 90136 | 35.07ms |
| Records第2页，展示切片 | 5 | 0 / 0B | 90231 | 37.15ms |

投影JSON是客户端解析结果的JSON估算；PG facts::text包含不同空白，两者均不是wire账单。临时localhost POST调用既有revalidatePublicStatsTag owner；该测试入口已移除，不加入产品或部署。没有统计缓存第二套materialization。该规模能完成冷填充，warm和翻页无projection重读；冷填充仍O(history)、约3.4–3.6秒及9.62MB投影JSON，频繁上传失效仍可能放大读取，**没有证明托管egress安全或可接受计费**。以此作为容量边界证据交审，不把2-map/100-event列表负载冒充历史规模验收；生产托管实测仍是release未执行项。HTTP采样是本轮规则/缓存代码的本地构建，后续仅短标签文案变化。

UI终审使用 CS 常见短标签（FD、Traded、Win after FD、Flash Output 等）；Opening 组合主行收敛为 `FD n · Traded x · Team Wins y`。正常页面只保留事实、指标与操作，Why? 展示 scope、percentile 与 peer value，不展示 insight floor、方法论免责声明或逐回合交集说明。Records/Insights 问号按需解释定义；无纪录只显示 `—`。授权 draft 选择器显示当前赛事名称，公开选项保持公开赛事范围；Header 只发送 slug 用于导航 active。

## 截图

- [Overview / 展开观察](overview.png)、[390px](overview-mobile.png)
- [Opening](opening.png)、[Utility / 负Net](utility.png)
- [六类 Records](records.png)、[移动端](records-mobile.png)、[问号展开](records-help-mobile.png)
- [100赛事移动选择器](selector-mobile.png)

## 未执行的生产验收

没有读取或修改生产数据，没有生产迁移/backfill/部署/合并。仍由既有 release/运维流程执行：生产 reserved slug冲突核查；新投影版本受保护重建、全coverage gate、托管超时/内存/容量；跨实例PUBLIC_STATS_TAG真实失效（含公开性撤回与新公开赛事）；托管cold/warm查询数、wire bytes、RSC payload和计费；staging rehearsal与production smoke。此PR停在代码审查点。

本轮 UI 文案终审：Stats 页面使用短标签与事实型空态，不再把“正向表达”理解为机械移除 `暂无`；用户可操作的空态给出动作，纯数据空态使用 `—` / `暂无…`。Insights 正常表面不展示算法 gate 或免责声明，Why? 使用 Pxx / Peers 等短格式；Records 无值不再追加解释句。问号绝对定位于标签外侧。此前统计组件、赛事选择器、320/390px 与 mobile-chrome 证据继续适用；本次文案改动以最终 HEAD 的 targeted tests 与 required CI 重新确认。
