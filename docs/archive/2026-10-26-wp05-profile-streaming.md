# WP05 本地实现与证据

生产基线及工作树起点：`1ec1f818a974e360e2f5aa732ced47640786502a`（v2.24.3）。候选 exact SHA 见关联 PR head 和 PR 描述。本记录不证明生产已优化或历史 OOM 根因已修复。

旧代码已先渲染 canonical 身份/公开制裁，并复用无筛选 career/lifetime；队伍阵容已批量读 performance。此次只拆分后续 16 项等待，单次请求创建 basic、overview、history、performance 和按需 attributes 消费者，不复制 SQL 或改变统计含义。无其它整对象 reader 消费者，移除原组合入口。队伍阵容沿用原批量 performance 与公共 benchmark 并行，不引入新串行依赖。Next 16.4.2 的 `use-cache-wrapper` 已按公共 key 跨请求去重冷填充，继续复用，不增加缓存/池/依赖。

## 受控浏览器

真实本地 PostgreSQL、Local Supabase、Next 16.4.2 `build/start`，Chromium 156。临时 fixture 没有详细 performance；为验证等待边界，两个版本均强制消费公共 benchmark，并在其缓存函数中注入 1500ms 延迟和不含 SQL 参数的查询计数。最终代码均已移除。时间为各自同一 document 导航 `performance.now()`，没有相减独立中位数。单样本只用于验证阻塞关系。

| 导航 | 身份 | basic | overview | history | performance | attributes | SQL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 基线受控 | 666.8ms | 2329.4ms | 2329.3ms | 2329.4ms | 2329.4ms | 无独立边界 | 35 |
| 根评审后候选受控 | 710.6ms | 710.7ms | 710.7ms | 710.7ms | 710.7ms | 1889.7ms | 35 |

同导航 basic−identity：基线 1662.6ms，候选 0.1ms；候选 attributes−basic 1179.0ms。净收益是其它分区不再继承慢 benchmark 等待，未减少此导航查询数，未证明生产耗时或内存下降。

去掉重复进程级 promise 后，两个独立冷浏览器并发请求均 200、无 pageerror；基础资料在 721.2/776.8ms 出现，属性边界在 1967.3/1984.1ms 出现，缓存函数填充日志只有一次。验证使用框架原有去重。

初版候选赛事队伍 200/无 pageerror，primary 496ms、advanced 可见并 network idle 1041ms、38 SQL；长期队伍 200/无 pageerror，对应 403/931ms、22 SQL。这组采样来自曾将 careers→benchmark 串行的早期变更，根评审指出其正常队伍逆向风险后已完整撤回 lineup 改动，不作为最终队伍收益或无回归证据。最终队伍读取源码与 main 相同，保留原并行。

## 相称验证

- `pnpm type-check:app`、`pnpm type-check:tests`、定向 ESLint、`pnpm architecture:check`。
- 定向 unit：basic 不等慢 career/history；无筛选只读一次；event/map 与 lifetime 分离；统计和 benchmark 独立降级。
- 真实 PG 新分区测试：两赛事、历史/当前归属、公开教育撤回、赛事报名撤回；实际执行 profile SQL，13/12 查询，赛事名单同请求只读一次。统计计算和结果装饰在此测试中隔离，不能宣称其为完整统计端到端。
- 真实 PG 已有回归：player scoreboard map/official-test 隔离、public team facts batch、Steam identity foundation/merge，共 7 项通过。
- 无注入 production build 成功；无历史选手和两类队伍浏览器回归；没有调用付费 OCR 或真实比赛/资金。

新 unit 保护共享 promise 与延迟/失败的独立边界，PG 测试保护拆分后仍即时执行公开撤回谓词，现有统计算术测试不能替代这些拼装契约。

## 失败、未跑与交接

首个浏览器样本因本地数据库缺少 `matches.test_config` 失败，已通过仓库 `db:local:migrate` 对齐后重跑；该失败未计入收益。首次 Chromium 版本不匹配，安装锁定 Playwright 所需浏览器后重跑。PG 测试的单连接并行查询产生 pg 弃用提示，没有把它当成生产池容量证据。

A 已提供 #1138 的资源计数接口约定、C 已提供模块需求 token 约定；A provider 已按根合并 SHA 同步接入；C core 尚待同步，未自建替代实现。现有 `ContentReady player/primary` 仍等完整共享 sections，保留原测量语义等待 C 接线。没有采到生产/本地组合负载峰值，不能声称资源预算已验收。有效详细 performance 的多赛事浏览器组合仍未跑；已补单赛事双地图的真实 browser 正反例，见后续补证。

回退本 PR 的页面分区与 request composition 即恢复原等待边界，统计 owner、schema、权限、公开缓存身份边界不变。未合并、tag、部署或修改生产。


## 根评审后的几何与并行修正

撤回了初版 `lineup-style-query.ts` 的整项变更，最终队伍源码与 main 一致，保持 careers 与 benchmark 并行；不再宣称空阵容节省或队伍收益。基本资料、公开制裁和 Career Stats 保留原同一外层分组，组内独立流式读取；无属性时不插入空 DOM，避免 `space-y` 额外留白。

无注入本地 production build 的桌面 1360×1000、窄屏 390×844 截图对照逐像素一致（四个文件见 `evidence/wp05-screenshots/`；每对 SHA256 相同）。identity/basic/overview/history/performance 的矩形坐标完全一致。这组截图是无历史本地 fixture；有效详细 performance 和活跃制裁由下面新增的真实浏览器补证覆盖。公开制裁的 JSX 位置与原包裹间距已恢复。


## 必要浏览器边界补证（根复审后）

源码 exact SHA `82e9f936d80f160d994aafa38cf01dac4fc7f944`，真实本地独立 PostgreSQL 数据库（从 template1 创建，回放仓库 active migrations）、Next 16.4.2 无注入 production build/start、Chromium。资料为现有 `seedFixture` 和仓库 `normal-map-v1.json` 构造的 synthetic 官方统计范围，使用完整 Evidence parser、canonical `loadCanonicalTarget` / `validateCanonicalTarget`（无 issue）/ `materializeStatisticsProjectionInTx` 写入有效投影，不是真实运营比赛，也未调用 OCR。

实际 reader 预检：All-time 2 图、44 回合，detailed coverage 2/2，performance 非空；Event=wp05-detailed、Map=de_mirage 为 1 图、22 回合、coverage 1/1，performance 非空。浏览器实际渲染打法画像；全部六个场景通过、无 pageerror：

1. 双地图详细表现 + 活跃公开制裁横幅、禁赛头像标记与公开说明可见；横幅位于生涯统计之前。
2. 真正操作 Event/Map 下拉框：表现切为 1 图，生涯头部仍为 2 图；打法画像保留。
3. 390×844 窄屏：活跃制裁和双图生涯/表现仍存在。
4. 请求该赛事没有的合法地图 de_nuke：恢复赛事范围 URL，不混入其它地图过滤语义。
5. 无历史、无制裁选手：0 图，未伪造属性画像或制裁。
6. 同一个 Next 服务进程中将本地 case 改为 revoked 后重新请求：当前横幅和禁赛头像标记消失，纪律历史显示“已撤销”，详细统计保持；不借助服务重启清缓存证明即时撤销读取。

正反例均检查响应 HTML 和实际 DOM 不含内部证据、草稿说明、未来生效说明标记。只验证公开 read-model 的状态投影，不声称覆盖管理员签发/撤销 mutation 的授权流程。

原始结果和两屏截图位于 `evidence/wp05-rich-browser/`。fixture 准备失败保留在本地原始日志：首次 TSX CJS 不支持顶层 await，未执行 DB 创建；改为 async main 后首次数据准备违反 `(map_id,perfect_name)` 唯一约束，事务回滚，随后删除该任务独占的失败数据库，以唯一 synthetic 名称重建成功。补充完整合同校验时又发现可选 stageRunId 写 null、participant resolution 仍引用原始 fixture entry 的问题，均在写入确认投影前被解析器拒绝；修正 synthetic 目标引用后重建任务独占数据库，完整 parser/canonical validator 和 reader 预检通过。上述早期结果不作为最终合同合法数据的证据。未更改约束或重试真实提交。

归档脚本为本次手工受控证据，不新增 workflow：`fixture.ts` 复制到仓库 `.agent-tmp/wp05-rich-fixture.ts` 后经现有 `run-server-cli.ts` 执行，必须用 loopback 环境；`create` 记录独占数据库名，`drop` 只允许 `rh_wp05_browser_<12 hex>` 形状的该 manifest 数据库。浏览器脚本从当前 loopback DATABASE_URL 推导该 manifest 独占库；WP05_BUILD_SOURCE_SHA 必须填写实际 production build 的 exact 源码，WP05_EVIDENCE_DIR 指定输出目录，本地 helper 将该独占库注入 app 环境，不连接生产。该隔离数据库将在本轮取证后删除。


## Provider 接线边界

根合入 #1138 / `2d162d20daa20bb2fd8b1b8e622b83336500ed9d` 后已使用其 `beginRuntimeResource(name): () => void`。shared profile eager request 的 basic/overview/history/performance 只计一次 `profile.public.read`，全部 settled 后 finally 完成；同步构造失败也在 finally 完成。可选 attributes 的实际重统计由独立 stats fill 观察。`cached-query.ts` 的公共 cache callback 与 benchmark callback 通过同一个轻量 `observePublicStatsFill` 包裹真正填充，成功、同步或异步错误均 finally 结束；不在 lookup、draft bypass 或 RSC 消费者上包 fill，不带 user/URL，不复制 provider，也不自行实现预算。

C #1140 core 仍待精确合并 SHA。当前页面分区、赛事队伍 advanced 都由导航 eager 启动，保留既有导航首次 ready；原生 details 和已有 DTO 视图切换不会启动新后端工作，不插入虚构 demand。若 core 变更要求 consumer 接线，按根确认的模块合同接入；将来主动展开才发起读取时，在启动事件保存 beginTelemetryDemand token，实际 UI 呈现后 recordDemandReady，同一 token 的取消/旧身份/幂等由 core 负责。未把这份待办当作已经完成的 runtime/ready 集成。
