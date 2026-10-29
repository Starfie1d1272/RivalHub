# Supabase 新组织迁库

适用于新建 Production / Preview 项目、迁移数据和配置并切换网站。仅调整所属组织时，先评估官方 [Project Transfer](https://supabase.com/docs/guides/platform/project-transfer)。执行前核对实际套餐、项目名额和费用；迁组织不保证解决持续用量问题。

发布与远程写入遵循 [release](./release.md)；备份格式、对象保留策略与恢复入口遵循 [disaster recovery](./disaster-recovery.md)。现有 restore 入口限定 isolated target，正式迁库须使用经过审查的受保护路径，保留目标校验。

## 1. 准备

开工前按实际盘点填好以下清单，一次向用户确认；范围不变时不重复询问，新增目标或风险再单独说明：

- **目标与成本：** 源项目和组织、目标组织及新项目名称、区域、套餐和名额；默认不购买套餐、不永久删除。
- **凭据与目的地：** 列出需要使用或生成的数据库密码、API/JWT、SMTP、任务凭据和流量归因 `DB_TRAFFIC_KEY`；如需撤销旧 JWT 签名密钥，也列出先停用目标项目 legacy anon/service_role API keys 及受影响的调用方，以及各自的安全来源和用途；列出实际写入的新 Supabase Auth/Vault、自托管生产服务器、GitHub production/staging environment、现用 telemetry Worker 和其他现用 consumer；若归因发送需要现有代理，列明代理与目标、凭据和传输用途。只写名称与来源，不展示密钥值。
- **迁移与中断：** 暂停 Dev 腾名额及旧 Production 的安排和窗口；DB/Auth/Storage 的备份、恢复、冻结对账、切流、验收与旧库保留/回退范围。


记录源/目标 project ref、region、PG 版本、线上 tag/commit、源 Drizzle ledger、拟发布 commit、DB/Storage 快照时间、写入冻结窗口及回退安排。确认创建、暂停、切流的授权范围，旧生产保留；付费或永久删除单独决定。

| 范围 | 核对内容 |
| --- | --- |
| 数据库 | schema、ledger/hash、扩展、序列、权限/RLS、TLS/CA |
| Auth 与邮件 | users/identities、密码 hash、确认状态、角色；SMTP/Resend、模板、redirect URLs、限流 |
| Storage | bucket 配置、真实对象 bytes/checksum、业务引用和 retention |
| Realtime / scheduler | private policy、JWT 签名、pg_cron/pg_net、Vault、endpoint 与 credential |
| Consumer | GitHub production/staging、Vercel Production/Preview、备用机及外部集成 |
| 外部 provider | Turnstile、Steam、OCR、日志与 R2 recovery；按当前代码补全 |

只记录 secret 名称、来源和 presence。提前确认完整备份与匹配的离线 age 解密材料；新密码安全保存。SMTP 等不可反读的 credential 集中列为 Owner TODO，继续其它独立准备，相关功能在补齐前保持未验收。

已保存的迁库 DB 与 SMTP 凭据默认从操作员的 `~/.config/rivalhub/credentials/` 查找，确认文件权限与可用性后复用，不在日志或报告中输出。已有 Supabase CLI 管理凭据可用于经授权的官方项目创建入口；先核对目标组织、区域、Free 名额和费用，创建后回读项目身份。

Free 项目名额不足时，可在授权后采用“暂停旧 Dev → 创建新 Production → 恢复并验收 → 最终冻结和对账 → 暂停旧 Production → 创建新 Dev”。暂停旧生产会影响仍连接它的服务，须明确中断窗口。

## 2. 恢复并对账

1. **固定来源。** 获取一致 DB snapshot，记录文件 hash 和完整性。DB 与 Storage 不是跨系统原子快照；单独记录对象来源时间，复核业务引用及对象变化。
2. **验证目标。** 确认 source 与 target 不同，目标业务为空，允许的静态 seed 明确。依据 Drizzle ledger 重建源精确 migration 前缀；CLI migration list 不能替代 Drizzle ledger。
3. **导入数据。** 保留 UUID、Auth canonical users/identities、密码 hash、确认状态与角色；适配 managed schema 差异。跨项目会话策略须显式确定，不能直接复用旧 JWT/refresh token。
4. **核对数据。** 按[验收证据清单](#4-验收与回退)核对数据，保留时间戳及数字精度。按目标 release 升级 migrations，完成所需 backfill/coverage 后再接流量。
5. **恢复文件。** 通过目标 Storage API 恢复真实 bytes，按[验收证据清单](#4-验收与回退)验证。若源 API 402，使用经验证的 full backup 并说明后续对象缺口；同数量、同大小不足以证明内容相同。DB-only dump 不能作为完整恢复产物。
6. **修复引用。** 更新当前可变业务引用中的 Storage origin，保留 immutable audit provenance。按 recovery retention 策略处理教育证据，过期对象不重新激活。
7. **恢复配置。** 重建 Auth/SMTP、Realtime、扩展、Vault 与 scheduler。邮件 credential 保存后回读模板和限流；切流前避免两套 scheduler 同时执行业务任务。

### 源 Storage 返回 402

- 在 Production recovery backup 的成功记录中定位最近可信 full backup，核对 source ref、快照时间、对象数及 R2 completion、sidecar 和 artifact。使用 [只读 fetch](./disaster-recovery.md#offline-read-only-fetch) 获取并验证三件产物；检查已有授权的 R2 访问环境，也可通过官方控制台查找对象。使用离线 recovery kit 中与备份 recipient 匹配的 age 身份解密，不复制或记录私钥。
- 官方控制台按钮若在响应体下载阶段失败，先核对下载列表；确认失败后，可在同一已登录浏览器直接打开该控制台提供的官方下载地址，完成后仍校验长度和 SHA-256。
- 可使用最新一致 DB 快照与较早 full backup 的 Storage，分别记录时间和差异。将备份对象索引与当前 `storage.objects` 按 bucket/key、大小逐项比较，检查当前更新时间是否晚于备份；有备份时 DB 元数据和可比 ETag 时一并核对，并核对 bucket 配置、业务引用和 retention。数量或总大小相同不能替代逐项核对，元数据一致也不等于当前 bytes 的哈希证明。冻结后重新核对，明确新增、删除、变更和无法验证的对象缺口。
- 恢复前验证备份内对象 hash；向目标上传后逐对象回读 hash，并验收权限和引用。若缺备份、读取权限、身份材料或存在未解决缺口，记录具体缺项，继续不依赖它的准备；不得把 DB-only dump 当作完整备份或跳过缺口切流。

旧模型迁入新模型时：先在独立本地实例恢复只读 source，按备份记录的 PG image version 操作；逐表声明映射和排除范围，执行 rollback-only dry-run。相同 PK/内容可幂等通过，内容冲突停止；时间戳采用无损表示，避免 JavaScript Date 截断微秒。历史迁移中的数据排除规则不能套用于新的全库迁移。

### 离线有界 digest 原型（不替代正式门禁）

[`offline-digest.sql`](../../scripts/db/recovery/offline-digest.sql) 是可复用的 **临时 fixture 表**服务端分块原型；没有生产 CLI、workflow 或迁库验收接线，拒绝任何非本会话临时表。正式迁库仍须完成上述计数、主键集合、canonical digest、FK 与业务 invariant 验收，不能用此原型摘要替换或缩小既有门禁。

合同固定为：同一 PostgreSQL major/UTF-8、相同列名/顺序/内建类型声明、单列 bigint B-tree 主键递增。每次 `after_key` 开区间 keyset 最多 128 行，返回 count、last key、canonical bytes 和 SHA-256 小结果；下一块使用上一块的 `last_key`，空块结束。两端必须使用同一 snapshot/冻结窗口、相同 schema 和 chunk size；保存每块范围与 digest，累加 count，不能把不同分块结果直接比较。主键保留 bigint/text，不经 JS Number。行包含主键，digest 可发现同数量下的键/内容差异，但不能代替独立 PK 集合与业务规则验收。不一致时才在已定位的有界键范围内审查差异；不输出行正文到 CI/聊天。

- numeric 在 PostgreSQL 中 `trim_scale` 后转十进制 text，无浮点舍入；整型、boolean、UUID 使用各自数据库文本表示。numeric 的 scale 不作为值差异，schema/typmod 仍由既有 schema 验收负责。
- timestamptz 在数据库内转换 UTC，格式包含六位微秒与 AD/BC；infinity 单独保留文本。不会经过 JS Date，也不受 session timezone 影响。无时区 timestamp 尚无映射合同，拒绝。
- text 按 UTF-8 原字节，不做 Unicode/case/locale 归一化；NULL 编码 `-1:`，非空值为 UTF-8 byte length、冒号、正文，空字符串与 NULL 不同。列名与类型进入摘要 header。排序只按 bigint 主键，无 locale/collation 比较；文本主键不支持。
- JSON/JSONB（包括键序、嵌套 numeric 与 JSON null）、float、数组、domain、复合及其它未列明类型均在读行前 fail closed。当前没有经过验证的跨类型 canonical owner，不能将 `jsonb::text`、JSON.stringify 或未经验证的键排序当成相等证明。
- 最多 64 列，单 cell 最多 64 KiB、单行最多 256 KiB；有界 page 最多约 32 MiB canonical text，聚合只排序最多 128 个固定长度 row hash，无全表 JSON 聚合或 payload 排序。超限报错，不截断、不跳过。这些是值完成文本编码后的检查，不是 PostgreSQL 进程的硬 RSS 上限，也不保证任意巨型 text 在解 TOAST、编码或拼接前就被限制；page 之外的执行器和临时分配另有开销。原型只用于已知大小的隔离 fixture，大对象/复杂类型需要另行设计分片合同，不能以相同截断摘要放行。

本地 PostgreSQL fixture 验证时，在同一个 disposable session 中顺序加载 prototype 与 [`tests/fixtures/recovery/offline-digest.sql`](../../tests/fixtures/recovery/offline-digest.sql)。fixture 用临时表、结束 rollback，验证乱序插入/keyset、超 JS 安全整数的 numeric、小数与微秒单字段变化、NULL/空字符串、UTF-8，以及 JSONB/永久表/超限拒绝。它只证明受支持 fixture 合同；没有生产全表验证，也没有减少线上流量的实测。

## 3. 同步配置与切流

全仓搜索旧 project ref，更新有效 consumer；历史记录保留。重点检查 `scripts/db/*-environment.ts`、`src/lib/runtime/preview.ts`、Preview snapshot URL、release/backup/staging/refresh workflows 的目标校验。通过提交与 CI 更新 guard，禁止删除 guard 绕过失败。

- Production / Preview 分别同步 DB URL、Supabase URL、现代 API keys、独立 JWT/session/cron credential，核对所有使用方。变量契约见 [deployment](../deployment.md)、[Preview mirror](./preview-mirror.md) 和 [recovery](./disaster-recovery.md#provider-配置与凭据)。
- 公开变量在构建时内联，变更后重新构建。保持 CA/hostname 校验和 provider SSL enforcement。
- 检查在途 workflow 与旧 tag，避免它们继续操作旧项目；备用机同步对应环境，见 [standby](./standby.md)。

切流顺序：

1. 冻结网页、管理员、外部集成和后台任务写入，暂停旧 scheduler。
2. 完成最终数据/对象同步与对账；全量方案须使用冻结后的最终快照，不能假定先前快照没有变化。
3. 确认目标 migrations、backfill 和 provider 配置就绪，按 [release](./release.md) 发布并回读 exact tag/SHA。
4. 验证正式站连接新 DB/Auth/Storage。新项目所需 provisioning 要逐项完成，不能只依赖 Release Plan 的代码差异判断；scheduler 通过受保护入口 provision/verify。
5. 失效可能残留旧 origin/快照的缓存，验证页面与核心操作，确认唯一有效写入端及 scheduler 后恢复流量。
6. 按 [Preview mirror](./preview-mirror.md) 重建 Dev，验证重复刷新、persona 登录与可逆写入；Production 私有数据和凭据不进入 Preview。
7. 从新 Production 跑 canonical full backup，确认 encrypted artifact、sidecar、completion 及 R2 实际 GET/hash 回读。

## 4. 验收与回退

完成前逐项记录以下证据；恢复及切流步骤引用同一份清单，冻结后最终对账须使用冻结后的结果：

- 数据计数、主键集合、canonical digest、外键、业务 invariant、ledger 与 coverage 通过。
- 恢复文件的 hash、大小、MIME 和权限通过；真实图片 GET、私有对象权限、登录与角色正确；邮件实际收件、找回/确认链接和跳转通过。
- Realtime 实际送达、跨场拒绝和 viewer 写入拒绝；scheduler 有新鲜成功记录。
- 正式 release 与目标身份一致；Preview/备用机隔离正常；新库 full backup 可读取和校验。
- 切流后观察实际用量与账单，按赛事负载复核约一周数据，迁库完成不等于费用下降已验证。

**新库未接收写入：** 保持冻结，修复目标或恢复已核验的旧部署/连接/scheduler，确保只有一个写入端。

**新库已接收写入：** 先冻结并保存增量。旧库已落后，优先向前修复；确需切回时先处理增量合并、冲突与对账。应用回退遵循 release compatibility gate，不自动反向执行 schema migration。

旧库按约定暂停保留，另行核实可恢复期限。清理本次明文 dump、凭据副本和无用临时文件，仅停止本次创建的恢复实例；保留脱敏证据和加密恢复材料。
