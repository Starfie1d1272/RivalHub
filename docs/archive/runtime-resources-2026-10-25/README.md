# A组隔离资源基线（UTC 2026-10-25）

应用源码/构建：`356b1a53048672d70ddbad7679184157ba6362be`，基于 v2.24.3 / `1ec1f818a974e360e2f5aa732ced47640786502a`；production Next 16.4.2，锁定 Node 24.22.0。BUILD_ID：`kwmYoPOVtUXNcZuT6xevO`。本地 PG/Supabase 99 条 active migrations 与 synthetic Local Major 2027 fixture；不是生产或真实赛事/资金测试。后续 main 合并 #1129 不包含本次资源代码，未将该历史基线冒充新 main 的组合验收。

实际 Next server 单进程运行于 Docker：512MiB memory.max、无 swap、1 CPU（cpu.max=100000 100000）、pids.max=128。镜像只提供兼容运行环境，实际执行项目锁定 Node 二进制。原始 image ID、状态、每阶段时间与请求字节/状态/耗时见 [raw.json](raw.json)，真实应用日志投影见 [samples.json](samples.json)。实验脚本为 `scripts/observability/resource-baseline.mjs`，仅允许 loopback DB/Supabase；使用 canonical local wrapper 的 env，不保存/输出该 env。

每轮进程冷启动，artifact/.next cache 保留；顺序交替 off/on、on/off、off/on。匿名 `/stats`、`/teams`、`/local-major-2027/bet`、`/seasons` 各冷/热一次，再12并发，空闲30与65秒观察恢复。每运行20次，共120次 HTTP，均200；不是浏览器 LCP，也不证明登录后业务数据正确性。每运行正常存活、OOMKilled=false；最后用 fixture 容器名清理。

| round | sampler | cgroup peak MiB | idle65s MiB | requests | failure |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | off | 127.52 | 107.19 | 20 | none |
| 1 | on | 123.57 | 106.90 | 20 | none |
| 2 | on | 123.54 | 109.07 | 20 | none |
| 2 | off | 124.38 | 106.61 | 20 | none |
| 3 | off | 122.40 | 108.13 | 20 | none |
| 3 | on | 125.43 | 107.30 | 20 | none |

采样开启的三轮均输出 `runtime.health.sample` 和 acquire/hold/waiting 全量桶；60秒空闲也会输出，不依赖下一次业务请求。pool generation=1，空闲时 total=idle=2、max=10。无新 pool、探测 SQL、生产 MemoryMax 修改或业务重试。

净收益是观测分母与事故前组成可用，而不是本轮降低内存：本地36次 checkout 包含快样本，acquire 开始时的 queued=0，但等待人数观察中有非零值，能区分原生队列与达到应用池上限。hold 分布、在途/峰值与固定资源 API 不保存逐请求记录。三轮 on/off 内存差异小且有噪声，不能量化生产性能收益；空闲值没有形成可外推的泄漏证据。

cgroup charge 与 RSS 是不同口径；宿主与运行使用共享二进制/文件页，不能相加或拿本地 charge 直接替代生产 RSS。读取 cgroup 的短时 cat 进程也计入该组峰值，原始数据保留此开销。60秒采样可能漏过瞬态内存组成；kernel memory.peak 保留该轮 cgroup 峰值，仍不足以识别具体填充者。resident cache bytes 未测，未与 in-flight 指标相加。

未跑：带身份 BET/profile、两路 LIVE、可靠完图与遥测后台长查询的完整组合、真实浏览器及生产实测。需 B/E/G/其他 domain fixture 集成后继续；不把匿名 BET 的200当作私有路径验收。本轮没有复现可归因的填充峰值，因此未增加自定义 cache handler、全局串行门禁或缓存预算。

历史 2026-10-25 北京时间21:48:47 OOM-kill 事实保留，kernel/cgroup事故峰值与具体分配者仍缺失；343MiB为重启后快照。本轮只inspect原host脚本，未重新尝试SSH或网络诊断，没有宣称根因已修。

验证：runtime-health/flush lifecycle 4项、redaction既有11项、runtime owner12项与真实本地PG pool7项；app/tests类型、changed-file ESLint、architecture、production build通过。PG验证回放99条迁移及126张public base table访问矩阵。原始本地日志保留于执行环境；前两次容器尝试分别在执行入口前因挂载目录权限、镜像ELF兼容性失败，应用未运行；改用兼容镜像并以workspace UID运行后完成六轮。较早未完成的预实验不并入该六轮数据。

回退：下次启动设置 `RIVALHUB_RUNTIME_HEALTH_ENABLED=0` 关闭周期采样与hook调度；模块/测试调用stop与unregister清理。代码可整体回退，无migration/容量/业务语义变更。关闭采样不清除仍由业务owner持有的唯一hook，重载同key替换，显式unregister按注册身份清理。

独立复审后的脚本修正：上述六轮由旧 readiness probe 驱动，它仅确认 release endpoint 可响应，没有核验状态/身份（普通 local build 未注入 release identity 时该端点会503）；因此该旧数据不提供 endpoint identity readiness 证据。120条业务HTTP原始样本确实全部200，未删除或改写。新脚本要求构建前设置合法local releaseTag与checkout exact SHA，并要求probe 2xx且身份匹配；非200业务响应先保存样本再使run与退出码失败，并等待全部并发结果以保留错误分母。补充两个guard测试，回放503 probe、错误/无效身份与500业务响应；脚本/测试改动不改变应用runtime，不重跑上述六轮。
