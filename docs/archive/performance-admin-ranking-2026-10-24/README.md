# 后台队长与策略引用减量

后台队长面板实际只展示前8名和候选总数。新reader在SQL固定approved、active、willing，沿用`selectCaptainSeeds`与`compareCaptainSeedCandidates`，不构建voter DTO；仅8名所需字段进入Client，完整候选总数另传。公开投票reader保留全voter契约；确认action仍独立重验。

真实隔离PG：100 active approved报名、12 willing，另含merged/pending候选，两票使第6个候选排首位。新旧前8名相同，数量12，排除无资格报名。SQL2→2，返回行101→13，结果JSON14535→1775字节，DTO20795→1623字节。测试`tests/integration/db/admin-captain-ranking.test.ts`通过；不是PG并发或生产p95证据。

换算策略引用保持SQL中的赛事顺序、policyVersion/fallbackVersion及registration_frozen/published_locked语义，一次构建policy→refs Map。纯投影对照100 policy/1000 event逐字段相等，规范化次数100000→1000；单次本地CPU41.114→1.874ms，仅说明该合成输入。既有真实PG策略生命周期及冻结引用用例通过，mutation未改。

这批只关闭A-CAPTAINS ranking和A-CONFIG refs Map子项。policy summary/detail、catalog pool/InTx、awards、needs_attention、draft和其他即时验收没有伪装为完成，保持独立交付。
