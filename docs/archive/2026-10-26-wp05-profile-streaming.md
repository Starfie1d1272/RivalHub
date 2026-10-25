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

A 已提供 #1138 的资源计数接口约定、C 已提供模块需求 token 约定；provider/core 精确代码尚未同步，未自建替代实现。现有 `ContentReady player/primary` 仍等完整共享 sections，保留原测量语义等待 C 接线。没有采到生产/本地组合负载峰值，不能声称资源预算已验收。有效详细 performance 的多赛事浏览器组合尚未跑；对应 scoped 语义由 unit 和现有真实 PG scoreboard 回归覆盖，不能冒充浏览器证明。

回退本 PR 的页面分区与 request composition 即恢复原等待边界，统计 owner、schema、权限、公开缓存身份边界不变。未合并、tag、部署或修改生产。


## 根评审后的几何与并行修正

撤回了初版 `lineup-style-query.ts` 的整项变更，最终队伍源码与 main 一致，保持 careers 与 benchmark 并行；不再宣称空阵容节省或队伍收益。基本资料、公开制裁和 Career Stats 保留原同一外层分组，组内独立流式读取；无属性时不插入空 DOM，避免 `space-y` 额外留白。

无注入本地 production build 的桌面 1360×1000、窄屏 390×844 截图对照逐像素一致（四个文件见 `evidence/wp05-screenshots/`；每对 SHA256 相同）。identity/basic/overview/history/performance 的矩形坐标完全一致。截图是无历史本地 fixture，不能代替活跃制裁与有效详细 performance 的浏览器覆盖；后者仍列未跑。公开制裁的 JSX 位置与原包裹间距已恢复。
