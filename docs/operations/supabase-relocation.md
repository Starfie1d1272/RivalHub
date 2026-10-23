# Supabase 新组织迁库

适用于新建 Production / Preview 项目、迁移数据和配置并切换网站。仅调整所属组织时，先评估官方 [Project Transfer](https://supabase.com/docs/guides/platform/project-transfer)。执行前核对实际套餐、项目名额和费用；迁组织不保证解决持续用量问题。

发布与远程写入遵循 [release](./release.md)；备份格式、对象保留策略与恢复入口遵循 [disaster recovery](./disaster-recovery.md)。现有 restore 入口限定 isolated target，正式迁库须使用经过审查的受保护路径，保留目标校验。

## 1. 冻结前完成准备

记录源/目标 project ref、region、PG 版本、线上 tag/commit、源 Drizzle ledger、拟发布 commit、DB/Storage 快照时间、写入冻结窗口及回退安排。确认创建、暂停、切流的授权范围，旧生产保留；付费或永久删除单独决定。

| 范围 | 核对内容 |
| --- | --- |
| 数据库 | schema、ledger/hash、扩展、序列、权限/RLS、TLS/CA |
| Auth 与邮件 | users/identities、密码 hash、确认状态、角色；SMTP/Resend、模板、redirect URLs、限流 |
| Storage | bucket 配置、真实对象 bytes/checksum、业务引用和 retention |
| Realtime / scheduler | private policy、JWT 签名、pg_cron/pg_net、Vault、endpoint 与 credential |
| Consumer | GitHub production/staging、Vercel Production/Preview、备用机及外部集成 |
| 外部 provider | Turnstile、Steam、OCR、日志与 R2 recovery；按当前代码补全 |

### 本地凭据与连续命名

操作员机器上的固定目录为 `~/.config/rivalhub/credentials/`（700），以下文件为 600，位于仓库外：

| 文件 | 用途与复用范围 |
| --- | --- |
| `supabase-db-password.txt` | 用户指定的后续新数据库密码；创建 Production 与 Dev 时读取 |
| `resend-smtp-password.txt` | 用户指定的 Resend SMTP credential；每个新项目配置相同 SMTP |

非秘密参数与编号记录存于 `~/.config/rivalhub/relocation.json`：SMTP host/port/user/sender、凭据路径、最后完成序号和下一候选组织名。已有配置优先使用；文件存在、非空、权限正确且实际认证有效时，无需用户重新提供。直接从文件读取并传入 API/客户端；不输出内容、放入命令参数、提交 Git 或复制到验收报告。永久凭据由本机操作员维护，保留至用户要求轮换或删除；任务临时目录里的兼容链接只指向固定文件，清理时不可跟随链接删除目标。恢复新机器需要用户可信的凭据备份或重新提供，Git 不承担凭据恢复。

新组织固定为 `rivalhub-nju-<N>`，数字递增（例如 `rivalhub-nju-1` 后为 `rivalhub-nju-2`，再为 `rivalhub-nju-3`）。创建前同时核对 API 组织清单、本地已分配记录和未完成迁移目标；同一次迁移重试复用已创建的组织/项目。新增迁移使用最大已分配序号加一；已暂停或历史组织的编号不复用。创建后立即记录实际组织 ID/ref，验收完成再更新完成序号。项目显示名沿用 Production/Dev 约定，目标身份始终用 provider ref 核验。

提前验证 Supabase Management/CLI、GitHub、Vercel、R2、SSH 的现有认证及权限，检查 age 解密材料、最近 full backup 与备用站 Basic Auth 来源。DB/SMTP 文件不会提供这些平台的登录权限；验证码、MFA、条款确认、失效 credential、套餐/名额限制仍可能需要用户介入。先尝试已授权的 API/已登录 Chrome，汇总真正受阻事项，完成其它独立工作；冻结前解决影响生产恢复的阻塞。SMTP 实际收件包含垃圾邮件检查，记录目标验证链接与 redirect，禁止记录完整 token URL。

项目新生成的 API/JWT key 必须从目标项目获取；Production/Preview 的应用 session/cron secret 分别生成并同步。DB/SMTP 复用不扩大到这些凭据。现代 publishable/secret key 与应用实际签名算法分别核验；不能把 JWT secret 的不透明回读值或新 signing key 当作旧 HS256 secret。

### 冻结前检查点

1. **工具可用。** 在干净工作目录按 manifest/lockfile 准备依赖，确认安装、CLI 与受保护发布认证可用；避免软链接其它 checkout 的旧依赖。检查目标 PG/provider 差异与需要的权限，先完成受支持路径的预演。
2. **数据可恢复。** 验证 full backup、age 解密、Storage bytes/hash；在源 API 配额受限时优先确认备份覆盖。预演一次 DB 导入及目标配置验证，保留可重复执行的映射/排除清单。临时脚本必须经过复核并显式绑定本次 source/target；旧任务脚本中的 project ref 不直接复用。
3. **发布可执行。** 目标 ref 可得后准备 consumer/guard、origin migration、scheduler provisioning 变更及 release metadata，完成 PR required CI、合并与 exact main CI；授权范围不含合并时，把待批准差异提前完成。更新生产目标 owner 会触发 scheduler provisioning；不得靠手工开 cron 补漏。
4. **副作用受控。** 合并新 guard 或切换受保护 secrets 前，先识别并暂停可能使用错误目标的 scheduled/dispatch workflow，确认在途任务结束；旧线上应用和旧 primary scheduler 在最终冻结前仍可继续运行。main CI 等待应在冻结前完成。新 tag 会触发受保护 Release，必须等最终同步通过后才推送。
5. **启动条件齐全。** 目标基础配置、实际 SMTP/Auth/Realtime/Storage 预验收完成；最终导入后的受保护 migration、backfill、发布仍由 release owner 执行。冻结前记录需暂停/恢复的 workflow、任务和入口，保留 `/api/system/release` 供发布读取 previous identity，并按下文处理 canonical 首页、candidate smoke 和 scheduler 所需访问。

Free 项目名额不足时，可在授权后采用“暂停旧 Dev → 创建新 Production → 恢复并验收 → 最终冻结和对账 → 暂停旧 Production → 创建新 Dev”。暂停旧生产会影响仍连接它的服务，须明确中断窗口。优先把旧 Dev 的停机用于释放新 Production 名额；旧 Production 的暂停安排在最终同步与对账完成之后；能独立维持可靠写屏障时，可保留到新站验收后。若新 Dev 的 ref 只能在暂停旧 Production 后获得，先完成 Production 迁移发布，Dev guard/配置与重建作为后续独立变更；不要为了提前取得 Dev ref 而延长生产冻结。执行前核对当时 Free 名额规则，不假设新组织自动获得额外名额。

## 2. 恢复并对账

1. **固定来源。** 获取一致 DB snapshot，记录文件 hash 和完整性。DB 与 Storage 不是跨系统原子快照；单独记录对象来源时间，复核业务引用及对象变化。
2. **验证目标。** 确认 source 与 target 不同，目标业务为空，允许的静态 seed 明确。依据 Drizzle ledger 重建源精确 migration 前缀；CLI migration list 不能替代 Drizzle ledger。
3. **导入数据。** 保留 UUID、Auth canonical users/identities、密码 hash、确认状态与角色；适配 managed schema 差异。跨项目会话策略须显式确定，不能直接复用旧 JWT/refresh token。
4. **核对数据。** 比较计数、主键集合、canonical digest、外键和业务 invariant，保留时间戳及数字精度。按目标 release 升级 migrations，完成所需 backfill/coverage 后再接流量。
5. **恢复文件。** 通过目标 Storage API 恢复真实 bytes，验证 hash、大小、MIME 和权限。若源 API 402，使用经验证的 full backup 并说明后续对象缺口；同数量、同大小不足以证明内容相同。DB-only dump 不能作为完整恢复产物。
6. **修复引用。** 更新当前可变业务引用中的 Storage origin，保留 immutable audit provenance。按 recovery retention 策略处理教育证据，过期对象不重新激活。
7. **恢复配置。** 重建 Auth/SMTP、Realtime、扩展、Vault 与 scheduler。邮件 credential 保存后回读模板和限流；切流前避免两套 scheduler 同时执行业务任务。

旧模型迁入新模型时：先在独立本地实例恢复只读 source，按备份记录的 PG image version 操作；逐表声明映射和排除范围，执行 rollback-only dry-run。相同 PK/内容可幂等通过，内容冲突停止；时间戳采用无损表示，避免 JavaScript Date 截断微秒。历史迁移中的数据排除规则不能套用于新的全库迁移。

## 3. 同步配置与切流

全仓搜索旧 project ref，更新有效 consumer；历史记录保留。重点检查 `scripts/db/*-environment.ts`、`src/lib/runtime/preview.ts`、Preview snapshot URL、release/backup/staging/refresh workflows 的目标校验。通过提交与 CI 更新 guard，禁止删除 guard 绕过失败。

- Production / Preview 分别同步 DB URL、Supabase URL、现代 API keys、独立 JWT/session/cron credential，核对所有使用方。变量契约见 [deployment](../deployment.md)、[Preview mirror](./preview-mirror.md) 和 [recovery](./disaster-recovery.md#provider-配置与凭据)。
- 公开变量在构建时内联，变更后重新构建。保持 CA/hostname 校验和 provider SSL enforcement。
- 检查在途 workflow 与旧 tag，避免它们继续操作旧项目；备用机同步对应环境，见 [standby](./standby.md)。

### 最短生产冻结路径

所有能在源继续服务时完成的预演、配置和 CI 在上一阶段完成；冻结窗口只包含最终一致数据同步、相称对账和受保护发布。没有经过验证的增量复制入口时，最终同步继续使用全量方案，不临时以 updated_at 或零散 upsert 代替删除、序列及跨表一致性。

切流顺序：

1. 冻结网页、管理员、外部集成和后台任务写入，暂停旧 scheduler。盘点直接 DB/API 写入端；需要锁时列出实际可锁表及 provider 内部表排除理由，保持 keeper 存活，并在锁就绪后建立一致只读事务。不能把 WAF 视为直接 API 写入的屏障。
2. 完成最终数据/对象同步与对账；全量方案须使用冻结后的最终快照。Storage 在预拷贝基础上核对最终清单与变更，变化对象重新取 bytes/hash；备份后的新增、覆盖或删除无法解释时停止切流，不能仅按数量/大小认定一致。
3. **调整发布期间的冻结屏障。** Release 需要 candidate smoke、canonical `GET /` 与 `/api/system/release`，并要求 scheduler 经正式域名取得新鲜 endpoint success；deny-all WAF 保留到 Release 结束会阻塞这些 gate。最终对账通过后，先确保旧目标无法再写入：默认官方暂停旧项目并确认完成，再撤销临时 deny-all WAF，随后启动 Release。若保留源在线，必须已验证独立于 WAF 的完整源写屏障，持续保持到旧项目暂停；单纯部分表锁不足以覆盖 Auth/Storage/API 写入。受 `CRON_SECRET` 保护的 scheduler 请求须可到达新站，不能通过取消应用认证放行。旧部署在新 candidate 接管前可能不可用，这段仍计入中断窗口。
4. 确认目标 migrations、backfill 和 provider 配置就绪，按 [release](./release.md) 发布并回读 exact tag/SHA。
5. 验证正式站连接新 DB/Auth/Storage。新项目所需 provisioning 要逐项完成，不能只依赖 Release Plan 的代码差异判断；scheduler 通过受保护入口 provision/verify。
6. 失效可能残留旧 origin/快照的缓存，验证页面与核心操作，确认唯一有效写入端及 scheduler 后恢复流量。
7. 确认旧 Production 已暂停；如仍保留源在线，此时暂停并确认状态后释放冻结 keeper。旧库保留。恢复面向新目标的后台 workflow，核对唯一有效 scheduler。记录恢复流量时间，后续任务不计入生产冻结窗口。

### 切流后的独立收尾

以下任务在 Release 完成、所需受保护 secrets/guard 已对齐后并行推进；backup 必须遵守 production-state serialization，不能提前挤占 Release 的同组 mutation：

- **恢复保障：** 从新 Production 跑 canonical full backup，确认 encrypted artifact、sidecar、completion 及 R2 实际 GET/hash 回读。
- **Dev 镜像：** 按 [Preview mirror](./preview-mirror.md) 重建 Dev。先检查 Release 是否已自动触发 refresh，再决定是否手动 dispatch，避免重复导出。五种 persona 登录、角色绑定、可逆写入和重复刷新恢复均须验收；Production 私有数据与生产项目 keys 不进入镜像。新 Dev 的 SMTP 通过管理配置单独设置，不从生产数据导出。
- **应用与备用机：** Dev ref/公开 key 确定后构建一次对应 commit 的 Vercel Preview 与 canonical standby 包；包下载、校验和上传可与 Dev refresh 并行。Dev 完成后安装、重启并验证。先验证 Basic Auth 凭据来源，再做外部 HTTPS 角色态验收；内部 HTTP 200 与外部未认证 401 只能证明各自检查项。

重复刷新优先复用该 run 尚在 1 天保留期内的脱敏 artifact，重跑指定 Dev job（`gh run rerun <RUN_ID> --job <DEV_JOB_ID>`）。执行前核对 source SHA、artifact 和该次实际 job ID；执行后比较导出步骤时间和目标结果，不能把 UI 列出的已成功依赖当成又导出一次。artifact 过期或策略/ref 改变时，按 canonical workflow 重新导出。五种 persona 与可逆写入验收集中在一次重复刷新前后，避免每种身份都重建一次 Dev。

## 4. 验收与回退

完成前逐项记录证据：

- 数据 digest、关系、不变量、ledger 与 coverage 通过。
- 真实图片 GET、私有对象权限、登录与角色正确；邮件实际收件、找回/确认链接和跳转通过。
- Realtime 实际送达、跨场拒绝和 viewer 写入拒绝；scheduler 有新鲜成功记录。
- 正式 release 与目标身份一致；Preview/备用机隔离正常；新库 full backup 可读取和校验。
- 切流后观察实际用量与账单，按赛事负载复核约一周数据，迁库完成不等于费用下降已验证。

**新库未接收写入：** 保持冻结，修复目标或恢复已核验的旧部署/连接/scheduler，确保只有一个写入端。

**新库已接收写入：** 先冻结并保存增量。旧库已落后，优先向前修复；确需切回时先处理增量合并、冲突与对账。应用回退遵循 release compatibility gate，不自动反向执行 schema migration。

旧库按约定暂停保留，另行核实可恢复期限。新库 canonical full backup 通过后，清理本次明文 dump/Storage staging、临时凭据副本及无用安装包，仅停止本次创建的恢复实例；保留脱敏证据，远端加密恢复材料按 recovery retention 管理。本地固定 DB/SMTP 凭据及 age 私钥不属于任务临时文件。

运行记录至少保留各阶段起止时间、冻结/恢复流量时间、source/target identity、exact release、backup/refresh run 与验收结论。区分生产恢复时间和全流程收尾时间；CI 排队/重跑、provider 初始化、导入、发布、Dev 重建分别计时。只对实际完成的检查写“通过”，将缺少访问凭据等限制与待办明确列出。
