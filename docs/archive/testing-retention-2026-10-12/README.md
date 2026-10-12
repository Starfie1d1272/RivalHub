# 长期测试精简首轮验收记录

这是历史验收记录，不是产品规则或持续测试数量配额。本批清理相对已修复的主分支未改变产品实现、预测 UI、流程、迁移链和 production 数据。基线冻结为 `4ac1ab3b5599bf61d6c553a506539d3f3b709dc0`；本分支从 PR #940 已合并的 `95bc1ea8f960171c0bfef65f63998f72daf86d8e` 出发。#940 已先独立交付，这里不重复提交。最终已同步主分支 `e78f0668`（#945）；#943 的 BET 就绪修复与 #945 的创建队伍输入就绪修复及两条新增测试完整继承，不属于本批清理改动。

## 计数及耗时

[measurements.json](./measurements.json) 保存精确结果；[files.csv](./files.csv) 逐文件列出删除理由、保留数和证据边界；[cases.csv](./cases.csv) 逐项列出展开后的原用例及保留/删除处置。CSV 的风险类别解释删除选择，不表示已人工逐行证明所有旧断言等价。

| 层级 | 原有效用例 | 保留 | 原本地 wall time | 精简后 |
| --- | ---: | ---: | ---: | ---: |
| unit/component | 2,984 | 106（含上游新增2） | 137.104 s | 15.173 s |
| real PostgreSQL | 352 | 309 | 215.775 s | 177.017 s |
| core browser | 17 | 17 | 未比较 | 未比较 |
| production smoke | 2 | 2 | 未比较 | 未比较 |
| optional acceptance | 14 | 0 | 未比较 | 退役 |
| capacity experiment | 12 | 0 | 未执行 | 退役 |
| 完整 collection | **3,381** | **434（原基线保留432 + 上游新增2）** | 不相加 | 不相加 |

测试文件原基线 623 → 129，加上 #943/#945 的两个新增文件，当前共131；物理测试源行以 measurements.json 为准。保留 **432/3,381（12.777%）** 是实际精简结果。用户明确比例只是目标，不是硬性门槛；验收优先独立保护、真实重复与维护成本，必要保护即使保留更多也可。不再以338个数量上限作为阻塞，不宣称当前集合是理论最小值。日常 required 原集合为3,355（不含acceptance/capacity）。

Vitest 数量来自实际成功运行的 JSON reporter；Playwright 来自实际 project 展开的 collection。容量通过 `vitest list --no-static-parse` 展开收集，未执行容量基准。静态定义不作为有效测试数：前期误计的 3,327、3,372 均不是验收基线。没有把用例塞进新循环、巨型 `it` 或参数矩阵；未增加 skip/todo 或放宽 timeout/retry，原已有参数矩阵及流程多断言保留原结构。

本地 unit 与 PG baseline/final 是相同 workspace/toolchain 的单次实测，取 reporter `startTime` 到最后文件 `endTime`。缓存、负载和 runner 不完全相同，不声称稳定加速；PG 不包含容器启动、迁移准备和 cleanup。这些层级时长不能相加冒充 CI wall time。浏览器集合未变，没有据此宣称更快；最终 GitHub run 和 required gate 证据记录在 PR；两个旧 head 的失败结果也保留，不改变 180 s 起点/预算。

## 删除选择与证据边界

- 删除源码字符串、内部实现、mock 转发、DOM/CSS、固定文案、formatter 和细粒度状态矩阵；保留公开 DTO、敏感信息脱敏和 server-only 架构拒绝契约。普通流程集中在真实 PG 和核心浏览器；经过同函数不表示逐断言等价，未精确替代的矩阵在 CSV 明示退役。
- 保留 BET 账本、金额守恒、未知结果/幂等、锁定、退款/反转/债务、资格和旧 publisher/reader 兼容；保留身份撤销、Auth fence、Data API 拒绝、迁移恢复和遗留数据 fail-closed。
- 保留 Major-24/32 真实生命周期与纯 placements 完整性拒绝。保留一个 upstream-choice 失效及输入不可变的独有 oracle；全 profile/bracket/slot judgement、无关 playoff 分支等矩阵退役；普通预测浏览器任务不替代这些 oracle，相关规则变化需要聚焦验证。
- LIVE 保留真实 ingest 的权限/source/generation/epoch/identity/lineup、幂等/canonical results，真实 private Broadcast/provider 和浏览器断流恢复，纯 token 续期/销毁、撤权清空和 proof/scope。精确时龄/reducer、storage-denial/two-match bound 等细矩阵退役，浏览器成功不替代它们。
- 删除非 required visual/capacity suites、空 config、孤立测试 helper，以及 planner 的已删除 product-language 显式路径。没有复制旧测试为 archive 可执行代码；需要实验时按具体风险临时重建。其它 capability/gate、跨仓兼容、provider、migration replay 和 timeout 保持。

## 安全脱敏保护恢复

后续独立发版审查发现三条不能由现有测试替代的安全断言被误删，已从原基线原样恢复：内层 PostgreSQL 分类必须抑制全部包装消息；现代 Supabase secret 在应用日志文本/code 中脱敏；CI artifact 无标签 secret 脱敏。范围只有三个原 `it`（应用2、artifact1），不修改实现、不恢复旧矩阵。三个局部故障变体各自仍通过原保留的8条，却均由对应恢复断言检出；正确实现11/11通过，临时实现修改全部还原。

同worktree两文件定向实测 1.095 → 0.954 s（8 → 11条，差值 -0.141 s）；只记录单次运行，不推断稳定性能。当前累计原基线保留432条，另继承上游2条共434；CSV纠正三条处置和原因，之前431条计数仍是 #942 合并时的历史事实。本恢复从 main `658d9cf3` 独立提出，交独审后再发版。

## 超额保留的具体边界

以下原测试被恢复，不能以空库 replay、同路径浏览器或同函数已执行声称等价：

| 边界 | 独立保护 |
| --- | --- |
| migration legacy data | captain/member provenance、重复/孤立 team、ambiguous Auth mapping、旧 bracket 外部依赖/跨赛事映射、legacy score/education URL 不一致时拒绝破坏性 DDL |
| finance compatibility | publisher0 禁止 relief 写入/replay；reader1/BP entries/run/pool correction 保持既有判断；历史 closed 与首次正式结果的 settlement hold |
| unknown DB outcome | 提交后响应丢失不再次写入，SQL constraint 和 rollback 正确 |
| roster/qualification/freeze | revision-scoped waiver、withdrawal claim/history、freeze 原子回滚、不完整 seed 拒绝 |
| commentary/scheduling | 真实 claimant、跨季/capacity guard、竞争 claim/取消、等待 row lock 后重查状态、proposal ownership 交接、legacy 无归属拒绝 |
| postevent/community awards | honors/adjudication/audit/archive 原子提交、disabled capability 对每种 mutation 拒绝 |

这些不是“同函数已经执行”的重复证据。留给独立审查，不为绿 CI 或百分比删除。

## 验证与交付

先完整运行原 unit（2,984/2,984）与 PG（352/352），再精简；未因产品测试失败删测试。精简时出现 empty describe 收集错误，修复 suite 结构后重跑，不是产品失败的删测规避。最终 unit 106/106（含 #943/#945 新增2）、PG 309/309；test/script typecheck、ESLint、architecture、Knip 与 GitHub required checks 以实际结果验收。Knip 暴露更多仅被旧测试引用的 production exports，这是待审查线索，未顺手删产品 API。

既有 BET 管理按钮 hydration 前首击丢失问题在 [#941](https://github.com/Starfie1d1272/RivalHub/issues/941) 独立跟踪，已由 #943 合入主分支。本轮不修产品，不声称 #940 或精简已消除所有 hydration race 或稳定满足 browser budget。Major 原首轮空名称创建失败已由 #945 独立修复并获独审批准合入；清理分支仅继承修复，最终 Major 首轮证据以此分支新 head 完整 CI 为准。后续 318 PG 的具体分类、9 个代表性/重复删减和保守集合差额见 [PG 风险审查](./postgres-risk-review.md)；两次旧 head CI 的 step/queue/bootstrap 拆分和可修复冗余见 [CI 审查](./ci-review.md)。

无 shipped behavior 变化，不需 Changeset。不自行合并、不发布、不操作 hosted database。

## 下一批和架构讨论

1. 对剩余集合独立逐 oracle 审查，先检查上述边界是否重复保护同一 canonical invariant；不能把多个 `it` 合成一个凑数。无法证明的保留，按独立风险与维护成本说明理由，不以比例作为门槛。
2. 审查 Knip 暴露 exports 的运行/跨仓/运维消费者，确认 owner 后删除真死代码；测试引用消失本身不证明 API 已死。
3. 讨论 release recovery 与 migration harness 是否可维护稳定 invariant 探针、减少历史 fixture。不是本轮实现：不改迁移 owner、不重构 transaction、不增加第二套事实来源。
4. LIVE 细时龄/cache 与预测 simulator 的退役 oracle 在相关规则变动时补聚焦证据；讨论哪些应长期恢复，不能用全绿 CI 反推没有风险。
5. #941 已由 #943 独立修复合入；继续将产品修复与测试清理分开验收，独立审查不冻结正常开发。

本次 Request changes 的故障注入、Major冷/缓存对照与未取得的精确候选清单见 [独审跟进](./review-followup.md)。

同步主分支前提交 `0a80831563e52e4d67b5bdb1ce3d5d027207f78c` 的完整 CI [38300176410](https://github.com/Starfie1d1272/RivalHub/actions/runs/38300176410) 一次通过，workflow 163 s；它不能替代同步后最终 head 的验收。#942 合并时的完整CI38305496485与main CI38306614454均通过；安全恢复的最新head/check证据以独立恢复PR为准，不能复用旧head证据。
