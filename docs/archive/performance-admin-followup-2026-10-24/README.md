# 后台后续窗口与摘要证据

基线为已合 #1083 的 main `06d0ea5074e15b866e2695b34e8f43ab761a9851`。这份材料不修改第一批历史数值，也不证明生产已改善。

三 view 的普通行均为25条。execution只为当前页读取完整match/score/demo展示字段，但排序窄事实仍读取当前阶段；未知阶段单独保留诊断。schedule仍读完整canonical stage来计算frozen runtime、积分榜及批量排期，只有展示行分页。materials先下推stage/team，再用原canonical map/demo-revision/scoreboard/reopened owner算准确待办集合，最后分页；没有对finished原始行先LIMIT。录像存在性、地图与scoreboard查询只选判定所需字段。

## 浏览器配对

Chromium desktop、hard navigation、开发服务器预热、等价独立生成fixture（不同UUID）、8 active + 100/500 finished，每个size/view各1样本。首轮仅文档的before/after数值见 `browser-document-before.json` / `browser-document-after.json`。不是p75/p95，不是生产数据。primaryDomReadyMs是普通行DOM首次有非零布局高度的MutationObserver时间（该行可能在viewport外），**不是产品CONTENT_READY或hydration完成时间**。next/back均在真实页面上验证，trace只保留本地fixture产物。

| finished | view | 解码文档 bytes before→after | DOM before→after | 单次LCP ms before→after |
| --- | --- | --- | --- | --- |
| 100 | execution | 990029→356717 | 2909→1172 | 2424→1372 |
| 100 | schedule | 856316→253426 | 2248→677 | 1956→1400 |
| 100 | materials | 271810→125836 | 766→322 | 1172→1120 |
| 500 | execution | 4066428→356776 | 11309→1172 | 9676→1168 |
| 500 | schedule | 3803607→253373 | 9849→677 | 5564→1048 |
| 500 | materials | 1110946→125783 | 3166→322 | 3580→776 |

解码文档包含HTML和内嵌RSC流，不能冒充独立RSC或wire bytes。CLS精确值约0.000184–0.000335，部分after样本轻微增加；保留session-window最大值算法和原值，不宣称零CLS或已证明无回退。

## 独立 Flight 编码与解码

另一次同形fixture对照基于共同main7f1b9d5a与候选72838d31，原值见 `browser-before.json` / `browser-after.json`。授权浏览器对**实际页面URL**发 `RSC:1` / `cache:no-store`，每次验证200与`text/x-component`，decoded取response ArrayBuffer字节，encoded取同源Resource Timing encodedBodySize，响应编码均gzip。它是完整root Flight探测，不是特定Next-Router-State-Tree的差量导航；没有把普通文档当Flight。

| finished | view | Flight gzip bytes before→after | Flight decoded bytes before→after |
| --- | --- | --- | --- |
| 100 | execution | 188231→56939 | 502179→156291 |
| 100 | schedule | 174878→49647 | 454860→128730 |
| 100 | materials | 33483→19062 | 142340→67608 |
| 500 | execution | 822586→56831 | 2184601→156138 |
| 500 | schedule | 717946→49570 | 2054900→128929 |
| 500 | materials | 120063→19080 | 586157→67642 |

DOM、文档encoded/decoded、LCP与精确CLS仍分别记录在每个sample；没有合并口径。schedule的完整server facts没有原样下发：runtime组件消费有界stage/run DTO，批量排期只消费group/count，普通Server rows只渲染当前25条。500场root Flight解码从2.05MB降至129KB是直接证据。所有数据仍是每cohort一个开发样本，没有部署p75/p95结论。

## PostgreSQL配对

同一隔离PG fixture、100/500 finished、8 active，每场finished含一个合法约1.5KB录像URL；3轮交错读。临时baseline模块来自精确06d0ea5，读完删除，不提交。`read-cost.json`仅含统计，不含记录、参数或凭据。

500场最终列投影：execution 7→8 SQL、543→568返回行、1043520→112655结果JSON字节；窄事实增加一次roundtrip及行数，不能写成“DB读取严格25行”。materials 9→9 SQL、502→502行、1009622→97122字节；canonical范围内扫描仍随规模增长。schedule 6→6 SQL、542→542行、1043502→139679字节：保留完整计算所需的match/run/比分事实，但不再拉取无消费者的录像正文与entry私有字段。两个共享standings函数仅缩窄输入类型，排名/历史恢复/排序实现不变；真实PG覆盖1:0胜负与13:8地图的净回合差。旧未缩窄列快照另存read-cost-pre-column-projection.json。没有用更早fallback冒充内容完成。

Main Swiss单场record与完整reader比较：已结束BO1的同一frozen run，4→3SQL，25→25行，14019→2967结果JSON字节。无run/跨scope/未知match/不完整finalized round均覆盖，原frozen规则与record投影函数复用；Play-in窄API已接入#1096 b820d4b6，临时集成验证其三个PG用例；保留原direct-BO3格式分支，不复制canonical pairing规则。

复现PG配对：

```bash
git show 06d0ea5:src/lib/admin/matches/overview.ts > src/lib/admin/matches/overview-list-baseline.ts
git show 06d0ea5:src/lib/admin/matches/postmatch-tasks.ts > src/lib/admin/matches/postmatch-tasks-list-baseline.ts
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 RIVALHUB_ADMIN_LIST_BENCHMARK=1 RIVALHUB_ADMIN_LIST_OUTPUT=/tmp/admin-list-cost.json pnpm test:integration -- tests/integration/db/admin-list-cost.benchmark.test.ts
rm src/lib/admin/matches/overview-list-baseline.ts src/lib/admin/matches/postmatch-tasks-list-baseline.ts
```

浏览器用 `tests/e2e/flows/admin-match-readiness.spec.ts`；before须在06d0ea5临时checkout放同一测试文件，设置 `RIVALHUB_ADMIN_READINESS_BASELINE=1`，after不设。两次均设置独立输出路径 `RIVALHUB_ADMIN_READINESS_OUTPUT`，只用本地fixture。

## 公告、信息与教育浏览器边界

`tests/e2e/flows/admin-content-read-boundaries.spec.ts` 在隔离真实PG、Local Supabase登录和Chromium中通过（32.6秒，retry=0，显式trace）。65条长正文公告：两个列表各显示20条，global next/back有效，完整root Flight不含正文marker；两个新建页为空表单，两个详情页保留完整正文；季赛详情拒绝同ID跨季访问。信息目录保留两种准确计数且Flight不含联系方式，两处详情保留完整联系方式。季赛管理员被拒绝访问教育审核且Flight无证据code，超级管理员可读取同一fixture证据。测试只执行读取和导航，结束检查公告正文/草稿状态未变；fixture写入、清理仅在本地隔离DB。新建页没有历史正文reader，未做无profile的bundle重构。

初始页面网络稳定后才发独立Flight探测；该等待不充当hydration或产品ready时间。完整trace仅留本地，不提交认证信息。Next开发服务器仍报告既有admin入口`connection()`缺少Suspense边界的警告；本用例证明内容/权限边界，不证明所有入口已达到instant navigation目标。

## 接口与限制

正式分支已安全rebase到main `c0d49610bd7a95ec8b529a48a3d7eaf7c1d1beb8`；下述22项PG与浏览器证据基于公共API已合的main7b619d2b临时集成，accounts、stats、public摘要/详情API均已合入。公告consumer在SQL固定季赛scope并只用summary/count，详情保留完整正文。教育overview/page独立返回受控错误，fresh授权在父page，证据过期owner不变。prestart union IDs只读一次不限定平台的raw bundle，再按profile/fallback投影。

Play-in reader来自独立PR #1096。临时集成验证pin `b820d4b6bac7fd690c05f9c9628f6886cfe976bf`；已对比最新候选 `dbb5eb8124fc5e52053f951c4f48fd11f0979dfb`，相关reader、presentation、PG测试无差异。该集成的app/tests类型、受影响ESLint、architecture与9个定向PG文件22例全部通过。最新main c0d49610 + #1096 dbb5eb81临时集成再次通过app/tests类型、测试文件ESLint、architecture及3个受影响PG文件5例；新fixture Main Swiss为4→3SQL/14003→2967结果JSON bytes，Play-in为4→3SQL/11→9行/1435→955 bytes，与历史样本分开记录。#1096仍待父会审查合入，之后必须同步main并以最新head的required CI收口；临时验证不是正式分支独立编译成功的声明。#1094保持Ready，不设置Draft门槛。

35页逐项状态见 `route-status.json`，精确文件与依赖见 `scope-files.json`。A-WB-5四子项与三个view分别列项。仍缺真实部署cohort、混合pool预算、500 active全局队列、慢教育overview的浏览器隔离；这些没有标为完成。未发布、未部署、未做生产写入。
