# Supabase 新组织迁库

适用于新建 Production / Preview 项目、迁移数据和配置并切换网站。仅调整所属组织时，先评估官方 [Project Transfer](https://supabase.com/docs/guides/platform/project-transfer)。执行前核对实际套餐、项目名额和费用；迁组织不保证解决持续用量问题。

发布与远程写入遵循 [release](./release.md)；备份格式、对象保留策略与恢复入口遵循 [disaster recovery](./disaster-recovery.md)。现有 restore 入口限定 isolated target，正式迁库须使用经过审查的受保护路径，保留目标校验。

## 1. 准备

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

Free 项目名额不足时，可在授权后采用“暂停旧 Dev → 创建新 Production → 恢复并验收 → 最终冻结和对账 → 暂停旧 Production → 创建新 Dev”。暂停旧生产会影响仍连接它的服务，须明确中断窗口。

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

切流顺序：

1. 冻结网页、管理员、外部集成和后台任务写入，暂停旧 scheduler。
2. 完成最终数据/对象同步与对账；全量方案须使用冻结后的最终快照，不能假定先前快照没有变化。
3. 确认目标 migrations、backfill 和 provider 配置就绪，按 [release](./release.md) 发布并回读 exact tag/SHA。
4. 验证正式站连接新 DB/Auth/Storage。新项目所需 provisioning 要逐项完成，不能只依赖 Release Plan 的代码差异判断；scheduler 通过受保护入口 provision/verify。
5. 失效可能残留旧 origin/快照的缓存，验证页面与核心操作，确认唯一有效写入端及 scheduler 后恢复流量。
6. 按 [Preview mirror](./preview-mirror.md) 重建 Dev，验证重复刷新、persona 登录与可逆写入；Production 私有数据和凭据不进入 Preview。
7. 从新 Production 跑 canonical full backup，确认 encrypted artifact、sidecar、completion 及 R2 实际 GET/hash 回读。

## 4. 验收与回退

完成前逐项记录证据：

- 数据 digest、关系、不变量、ledger 与 coverage 通过。
- 真实图片 GET、私有对象权限、登录与角色正确；邮件实际收件、找回/确认链接和跳转通过。
- Realtime 实际送达、跨场拒绝和 viewer 写入拒绝；scheduler 有新鲜成功记录。
- 正式 release 与目标身份一致；Preview/备用机隔离正常；新库 full backup 可读取和校验。
- 切流后观察实际用量与账单，按赛事负载复核约一周数据，迁库完成不等于费用下降已验证。

**新库未接收写入：** 保持冻结，修复目标或恢复已核验的旧部署/连接/scheduler，确保只有一个写入端。

**新库已接收写入：** 先冻结并保存增量。旧库已落后，优先向前修复；确需切回时先处理增量合并、冲突与对账。应用回退遵循 release compatibility gate，不自动反向执行 schema migration。

旧库按约定暂停保留，另行核实可恢复期限。清理本次明文 dump、凭据副本和无用临时文件，仅停止本次创建的恢复实例；保留脱敏证据和加密恢复材料。
