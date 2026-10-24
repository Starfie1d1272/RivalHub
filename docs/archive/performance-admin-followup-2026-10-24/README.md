# 后台后续窗口与摘要证据

基线为已合 #1083 的 main `06d0ea5074e15b866e2695b34e8f43ab761a9851`。这份材料不修改第一批历史数值，也不证明生产已改善。

三 view 的普通行均为25条。execution只为当前页读取完整match/score/demo展示字段，但排序窄事实仍读取当前阶段；未知阶段单独保留诊断。schedule仍读完整canonical stage来计算frozen runtime、积分榜及批量排期，只有展示行分页。materials先下推stage/team，再用原canonical map/demo-revision/scoreboard/reopened owner算准确待办集合，最后分页；没有对finished原始行先LIMIT。录像存在性、地图与scoreboard查询只选判定所需字段。

## 浏览器配对

Chromium desktop、hard navigation、开发服务器预热、等价独立生成fixture（不同UUID）、8 active + 100/500 finished，每个size/view各1样本。before/after完整数值见 `browser-before.json` / `browser-after.json`。不是p75/p95，不是生产数据。primaryDomReadyMs是可见普通行出现的MutationObserver时间，**不是产品CONTENT_READY或hydration完成时间**。next/back均在真实页面上验证，trace只保留本地fixture产物。

| finished | view | 解码文档 bytes before→after | DOM before→after | 单次LCP ms before→after |
| --- | --- | --- | --- | --- |
| 100 | execution | 990029→356717 | 2909→1172 | 2424→1372 |
| 100 | schedule | 856316→253426 | 2248→677 | 1956→1400 |
| 100 | materials | 271810→125836 | 766→322 | 1172→1120 |
| 500 | execution | 4066428→356776 | 11309→1172 | 9676→1168 |
| 500 | schedule | 3803607→253373 | 9849→677 | 5564→1048 |
| 500 | materials | 1110946→125783 | 3166→322 | 3580→776 |

解码文档包含HTML和内嵌RSC流，不能冒充独立RSC或wire bytes。CLS精确值约0.000184–0.000335，部分after样本轻微增加；保留session-window最大值算法和原值，不宣称零CLS或已证明无回退。

## PostgreSQL配对

同一隔离PG fixture、100/500 finished、8 active，每场finished含一个合法约1.5KB录像URL；3轮交错读。临时baseline模块来自精确06d0ea5，读完删除，不提交。`read-cost.json`仅含统计，不含记录、参数或凭据。

500场时：execution 7→8 SQL、543→568返回行、1043514→169290结果JSON字节；窄事实增加一次roundtrip及行数，不能写成“DB读取严格25行”。materials 9→9 SQL、502→502行、1009622→97122字节；canonical范围内扫描仍随规模增长。schedule SQL/结果量不变（6、542行、1043496字节），收益在呈现，不在DB。没有用更早fallback冒充内容完成。

Main Swiss单场record与完整reader比较：已结束BO1的同一frozen run，4→3SQL，25→25行，14019→2967结果JSON字节。无run/跨scope/未知match/不完整finalized round均覆盖，原frozen规则与record投影函数复用；Play-in窄API仍交public owner协调。

复现PG配对：

```bash
git show 06d0ea5:src/lib/admin/matches/overview.ts > src/lib/admin/matches/overview-list-baseline.ts
git show 06d0ea5:src/lib/admin/matches/postmatch-tasks.ts > src/lib/admin/matches/postmatch-tasks-list-baseline.ts
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 RIVALHUB_ADMIN_LIST_BENCHMARK=1 RIVALHUB_ADMIN_LIST_OUTPUT=/tmp/admin-list-cost.json pnpm test:integration -- tests/integration/db/admin-list-cost.benchmark.test.ts
rm src/lib/admin/matches/overview-list-baseline.ts src/lib/admin/matches/postmatch-tasks-list-baseline.ts
```

浏览器用 `tests/e2e/flows/admin-match-readiness.spec.ts`；before须在06d0ea5临时checkout放同一测试文件，设置 `RIVALHUB_ADMIN_READINESS_BASELINE=1`，after不设。两次均设置独立输出路径 `RIVALHUB_ADMIN_READINESS_OUTPUT`，只用本地fixture。

## 接口与限制

public `e7a7ae264b1ed63ffb8f12828ea2979b33f157c1`、accounts `c602550eb6d6c7580c5daf2122c782bf3ceddf85`、stats `ec0989a502b08f71f1a917e07b88e3cf02e13b17`仅用于临时集成验证：app/tests类型和架构通过；10个reader PG及8个qualification/prestart PG通过。公告consumer在SQL固定季赛scope并只用summary/count，详情保留完整正文。教育overview/page独立返回受控错误，fresh授权在父page，证据过期owner不变。prestart union IDs读一次不限定平台的raw bundle，再按profile/fallback投影。

最终依赖合入main后必须rebase并让最新head CI验证。35页逐项状态见 `route-status.json`，精确文件与依赖见 `scope-files.json`。仍缺真实部署cohort、混合pool预算、500 active全局队列、Play-in record窄API及慢教育overview的浏览器隔离；没有把这些写成已完成。未发布、未部署、未做生产写入。
