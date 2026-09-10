# Disaster recovery

本页是 RivalHub production 数据恢复的 canonical runbook。代码 owner 位于 [`scripts/db/recovery/`](../../scripts/db/recovery/)；本页只规定恢复边界、证据和操作顺序，不保存真实 PII、object key、signed URL 或 secret。

## 目标与状态

第一版采用全量 logical snapshot：production Supabase 数据库与真实 Storage objects 使用同一个 run identity，runner 在临时目录生成明文、计算 checksum、压缩后用 age 公钥加密，最后只把 `.age` artifact、sidecar manifest 和 completion marker 上传到 private Cloudflare R2。Recovery format 2 明确区分 `producer`（生成备份工具的 code/package identity）与 `source`（备份时 production 实际部署的 release/commit 和数据库 terminal）；两者不要求相同。

目标窗口如下：

| 场景 | Target RPO | Target RTO |
| --- | ---: | ---: |
| 报名截止、抽签、比赛进行中等关键赛事窗口 | ≤ 1h | ≤ 2h |
| 普通非赛事窗口 | ≤ 6h | ≤ 8h |

这些是目标，不是当前已达成的运营承诺。第一次真实 production snapshot → isolated restore rehearsal 完成前，achievable RPO/RTO 保持 `unknown / unverified`；演练必须记录 snapshot 创建时间、恢复开始/结束时间、验证结果和 gap。

## 备份 owner 与 artifact

| Owner | 作用 |
| --- | --- |
| `.github/workflows/recovery-backup.yml` | 每小时执行；也支持受保护的 daily/manual dispatch |
| `.github/workflows/release.yml` | production migration 前执行 `pre-release` backup hard gate |
| `scripts/db/recovery/backup.ts` | 唯一 logical backup、Storage snapshot、age、R2 read-back owner |
| `scripts/db/recovery/restore.ts` | 仅允许 isolated loopback target 的恢复入口 |
| `scripts/db/recovery/verify.ts` | migration、constraint、FK、identity、entry/roster、stage/match/result/honor、retention invariant verifier |
| `scripts/db/recovery/lifecycle.ts` | 在 isolated restore 后调用与应用 scheduler 相同的 education retention algorithm |
| `scripts/db/recovery/r2-config.ts` | R2 lifecycle 与 bucket lock provider contract 的 apply/read-back owner |

每份 artifact 的逻辑内容是：

```text
backup/
├── roles.sql       # 仅作恢复审查证据；不自动回放 provider-managed roles
├── schema.sql      # Supabase CLI 过滤后的 public schema snapshot
├── data.sql        # public + auth data-only COPY dump
├── storage/
│   ├── buckets.json
│   ├── index.ndjson
│   └── objects/*.bin
└── manifest.json
```

`manifest.json` 包含 format version、UTC 时间、固定 production project identity、PostgreSQL/Supabase CLI identity、三份 SQL digest、Storage object count/bytes/inventory digest 和 backup class。`producer` 包含 recovery format、生成工具的 package version/commit；`source` 包含 `deployedReleaseTag`、`deployedCommit` 和 `databaseMigrationTerminal`。Storage private object key 只存在于加密 artifact 内的 `index.ndjson`，不进入 CI summary、Issue 或 PR。

Supabase CLI 的 canonical dump 保留应用 schema 与 `auth.users` 数据，同时遵循 CLI 对 provider-managed schema/role 的过滤。`storage.objects` metadata 不被当成真实文件备份：每个 Storage object 通过 Storage API 单独下载、写入加密 artifact，并在 restore 上传后逐个 read back checksum。应用不把 Vercel、Supabase、GitHub、Steam/provider、scheduler 或 Vault secret 打包；这些是恢复后的独立 provisioning/config presence 检查。

### 跨系统一致性边界

数据库 dump 与 Storage inventory/download 是顺序操作，不是跨系统原子快照；`createdAt` 是本次 run 的 identity，不代表某个可回到的单一瞬间。第一版接受低流量赛事站的这个边界，不能把 artifact 描述为严格 point-in-time backup。Storage snapshot 完成后，backup 会再次读取当前数据库中的所有 managed object references；当前 schema 的 `education_verifications.evidence_object_key` 必须全部出现在同一份 Storage inventory 中，否则整个 run 失败。未来对高风险赛事窗口应增加 quiesce/freeze window；在此之前，manual/pre-release backup 仍必须把该 reference-inventory check 作为完成条件。

R2 key 是不可猜测的 run-specific key：`production/<class>/<UTC-date>/<run-uuid>.*`。Artifact、sidecar、completion marker 使用同一 run identity；completion marker 最后上传，且只有 artifact 与 sidecar 已完成 R2 HEAD metadata/size 检查和真实 GET 内容 hash read-back 后才会出现。PutObject 使用 `If-None-Match: *`，同名 artifact 不允许覆盖。

## Provider 配置与凭据

GitHub `production` job 需要能读取以下值；secret 可以放在该 job 可访问的 repository、organization 或 `production` Environment scope，具体以 workflow 的 `secrets` / `vars` 引用为准。值本身不得写入仓库、Issue、PR 或日志。

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `DATABASE_URL` | secret | production runtime / migration 使用的 Transaction Pooler URL（`:6543 / pgbouncer=true`）；现有 application/migration ownership 保持不变 |
| `RIVALHUB_PRODUCTION_BACKUP_DATABASE_URL` | secret（可选） | 经过 production project/host 校验的 Session Pooler（`:5432`）backup connection，只用于 backup dump 和只读 DB read；未设置时由 runner 从 `DATABASE_URL` 自动派生，复用相同凭据，不无必要增加第二份密码 |
| `SUPABASE_SECRET_KEY` | secret | recovery/backup lane 的 canonical Supabase secret API key（通常为 `sb_secret_...`）；供 runner 执行受控 dump 与 Storage snapshot 读取；credential 本身是 elevated access，不是 read-only credential，脚本不执行应用 mutation |
| `SUPABASE_SERVICE_ROLE_KEY` | secret（legacy fallback，可选） | 兼容已经存在的 JWT-based `service_role` 配置；只有未提供 `SUPABASE_SECRET_KEY` 时才读取，新部署不需要创建此 legacy key |
| `RIVALHUB_BACKUP_AGE_RECIPIENT` | environment variable | age 公钥；backup runner 只能加密 |
| `RIVALHUB_PRODUCTION_BASE_URL` | environment variable | production canonical HTTPS origin；未设置时默认 `https://match.starfie1d.top`，runner 从其 `/api/system/release` read back deployed release identity |
| `RIVALHUB_R2_ACCOUNT_ID` | environment variable | R2 account identifier |
| `RIVALHUB_R2_BUCKET` | environment variable | private recovery bucket |
| `RIVALHUB_R2_ACCESS_KEY_ID` | secret | bucket-scoped R2 S3 credential |
| `RIVALHUB_R2_SECRET_ACCESS_KEY` | secret | bucket-scoped R2 S3 credential |
| `CLOUDFLARE_API_TOKEN` | secret | 仅 R2 retention workflow 的 provider read/apply |
| `VERCEL_TOKEN` | secret | project-scoped `rivalhub-release` token，仅供 release deploy |

`recovery-backup.yml` 与 release 的 pre-release backup 会先读取 `SUPABASE_SECRET_KEY`，只有在它为空时才 fallback 到 `SUPABASE_SERVICE_ROLE_KEY`。因此新的 production 配置只需要创建现代 Supabase secret key；本次只收口 recovery/backup lane，应用其它 server-only 代码仍保留现有变量名，未扩大成全仓库 key migration。

age private key只保存在离线 recovery kit/password manager。解密演练时通过本地 `RIVALHUB_BACKUP_AGE_IDENTITY_FILE` 指向权限受限的临时 identity file，演练结束后删除临时明文和 identity 副本；不得把 private key 放入 GitHub Environment、仓库或 R2。Vercel protected smoke 不使用长期 bypass secret，而由 release job 的 GitHub OIDC 短期 token 完成；Trusted Source 是 Vercel owner 的 Dashboard 配置，不是 recovery artifact 或 GitHub secret。

### Vercel Trusted Source（owner-only）

首次受保护 release 前，Vercel owner 必须在 `Settings → Deployment Protection → Trusted Sources → External Services → Add → GitHub Actions` 建立 Trusted Source。先在引导表单选择真实项目范围，再切换 `Edit raw claims` 把 release workflow 锁死：

| Dashboard 字段 | 当前值 |
| --- | --- |
| GitHub account | `Starfie1d1272` |
| Repository | `RivalHub` |
| Branch | 留空（release 使用版本 tag，不是固定 branch） |
| GitHub Actions environment | `production` |
| Audience | `https://github.com/Starfie1d1272` |
| Applies to environments | `Production` |

Issuer 由 GitHub Actions provider 固定为 `https://token.actions.githubusercontent.com`。在 raw claims editor 中加入以下精确值（claim 名称和值均区分大小写）：

| Raw claim | 精确值 |
| --- | --- |
| `aud` | `https://github.com/Starfie1d1272` |
| `repository` | `Starfie1d1272/RivalHub` |
| `repository_id` | `1231811932` |
| `workflow` | `Release` |
| `environment` | `production` |
| `sub` | `repo:Starfie1d1272/RivalHub:environment:production` |
| `event_name` | `push`, `workflow_dispatch` |

不填写 `ref` 或 `workflow_ref`：tag push 的实际 ref 是 `refs/tags/v<version>`，手动 retry 的 dispatch ref 也不是一个固定值，而 Vercel claim matching 是 exact match、没有通配符。workflow 自己仍会验证 tag commit 属于 `main`；Trusted Source 则由 repository、repository_id、workflow、environment、sub 和 event_name 共同收窄。release job 仍运行在 GitHub `production` Environment 中；代码只负责申请 OIDC token 和发送 `x-vercel-trusted-oidc-idp-token`，不能代替 Dashboard 配置；配置缺失时，release exact-deployment smoke 必须 fail closed。

本 PR 不代替 provider account/Dashboard 核验：Supabase plan、automatic backup、PITR 与 provider retention 当前状态保持 `unverified / pending operator read-back`，不能作为本 Issue 已完成的 acceptance evidence。

### R2 retention contract

使用 `.github/workflows/recovery-r2.yml` 的 `verify` 实际 read back provider 配置；首次配置或变更时，在 production Environment approval 下选择 `apply`。首次 apply 优先建立并验证 7-day bucket lock，再 apply lifecycle，最终完整 read-back。脚本先读取现有规则，保留真正无冲突的 unrelated provider rules（如 `staging/`、`logs/`）；同名 RivalHub rule 若不匹配则 fail closed，并严格拒绝可能缩短 `production/` retention 的未知 overlapping destructive lifecycle rule。

`verify` 同时还会 read-back 并证明 canonical recovery bucket 没有启用 managed `r2.dev` public access，且没有任何已启用的 custom domain，确保 recovery 备份完全私有。

期望规则：

- `production/hourly/` lifecycle 48h；
- `production/daily/`、`production/pre-release/`、`production/manual/` lifecycle 30d；
- `production/` bucket lock 7d。

Bucket lock 优先于 lifecycle，因此 hourly object 的有效最低保护期至少为 7d；48h 是 rolling hourly lifecycle 目标，不得把它解释成 48h 后一定可删除。字段和 API payload 以 [Cloudflare R2 Lifecycle API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/lifecycle/) 与 [Cloudflare R2 Bucket Lock API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/locks/) 为准。R2 的 lifecycle、lock 与私有访问配置在首次真实 provider `verify` 前仍是 `unverified`，不能用仓库常量代替 read-back 证据。

Supabase 当前 plan、automatic backup、PITR 和 provider retention 也必须在 Dashboard/provider account 中人工读取并记录安全摘要（plan/capability/retention，不记录 credential、用户数据或下载的 dump）。没有该记录时，不能把 provider physical backup/PITR 写成已可用；R2 logical snapshot 仍是 RivalHub 自己可验证的 baseline。

## Backup 命令与失败语义

普通本地 shell 不应运行 production backup。受保护 workflow 调用同一个 canonical command：

```bash
pnpm db:recovery:backup hourly
pnpm db:recovery:backup daily
pnpm db:recovery:backup manual
pnpm db:recovery:backup pre-release
```

command 必须同时满足 `RIVALHUB_DB_TARGET=production`、固定 project confirmation、固定 pooler host confirmation、production URL 校验、Supabase secret API key（canonical 为 `SUPABASE_SECRET_KEY`，兼容 fallback 为 `SUPABASE_SERVICE_ROLE_KEY`）、age 公钥和 R2 credentials。它不要求 production write authorization，也不执行 application mutation。任一 database dump、Storage 下载、加密、上传或 R2 read-back 失败，整个 run 失败且不产生 completion marker；workflow 不上传明文 Actions artifact。

Release 顺序是：

```text
immutable tag/source validation
→ verify production deployed source identity
→ local migration/release compatibility
→ fresh pre-release backup + R2 read-back
→ production migration
→ production verify
→ exact deploy/smoke（GitHub OIDC → Vercel Trusted Source；canonical identity ordinary HTTPS）
→ scheduler provision/verify
```

pre-release backup 失败会阻止 production migration。hourly 与 release 不复制 dump 逻辑。

为了消除 release production migration 与 scheduled/manual backup 之间的竞态，`release.yml` 与 `recovery-backup.yml` 共享 canonical 串行化并发组 `rivalhub-production-state-serialization`（`cancel-in-progress: false`），确保两者严格互斥执行，避免在 backup identity read-back 与 dump 之间发生并发 migration。

`source` identity 必须从 `RIVALHUB_PRODUCTION_BASE_URL` 指向的 canonical production endpoint `/api/system/release` 通过 HTTPS read back；成功响应严格只包含 `releaseTag` 与 `releaseCommit`。runner 随后在本地 Git 中解析该 tag 并要求其 commit 与 endpoint 返回值完全一致，任何 endpoint 不可达、响应异常、tag 缺失或 tag/commit 不匹配都会 fail closed。`RIVALHUB_PRODUCTION_STABLE_REF` 只服务 release-compat 的 migration lineage 检查，不能作为 production deployed identity；backup 不使用 Git 推断 fallback，也不接受手工 tag/commit override。

## Isolated restore

普通 restore 入口只接受显式 isolated loopback target；代码没有 production destructive restore command。以下变量必须明确设置：

```bash
export RIVALHUB_RECOVERY_TARGET=isolated
export RIVALHUB_RECOVERY_DATABASE_URL='postgresql://...@127.0.0.1:.../postgres'
export RIVALHUB_RECOVERY_SUPABASE_URL='http://127.0.0.1:54321'
export RIVALHUB_RECOVERY_PUBLISHABLE_KEY='...'
export RIVALHUB_RECOVERY_SERVICE_ROLE_KEY='...'
export RIVALHUB_BACKUP_AGE_IDENTITY_FILE='/private/path/recovery-identity.txt'
unset RIVALHUB_ALLOW_REMOTE_DB_WRITE
```

也可以设置 `RIVALHUB_RECOVERY_USE_LOCAL_SUPABASE=1`，由 CLI 读取当前 Local Supabase status；这只适用于全新、专用、可丢弃的 isolated stack。仓库日常 Local Supabase 不是恢复目标；若目标已有任何 app/Auth/Storage rows，restore 会拒绝继续。不要对含有其它工作数据的本地栈执行 reset 来绕过这个检查。

restore 必须使用 exact shipped tag 的兼容 application release，但不要求它等于生成 artifact 的 producer commit。典型的 pre-release 场景是：候选 release/application code 为 N，`producer` 为 N，production `source` 与 snapshot database terminal 为 N-1。

普通恢复目标准备路径如下：

```text
fresh isolated Local Supabase stack
→ restore 读取 manifest.source.databaseMigrationTerminal
→ 从当前 shipped code N 的 active migration chain 截取到 terminal N-1
→ 在临时 migration directory 中只 replay N-1 prefix
→ data-only dump restore
```

因此恢复工具运行在 N 的 exact shipped tag 时，仍可为 snapshot 构造 N-1 schema；它不会把 fresh target 自动推进到 N，也不会对已有 ledger 做 downgrade。目标已有任何 rows 或 Drizzle migrations 时，入口继续拒绝，必须换新的 disposable target。

在这个 target 上执行：

```bash
pnpm db:recovery:restore \
  --artifact /private/path/run.tar.gz.age \
  --manifest /private/path/run.manifest.json \
  --completion /private/path/run.complete.json
```

restore 顺序固定为：

```text
sidecar/completion/artifact checksum
→ age decrypt + safe archive inspection
→ recovery format/source identity/compatible shipped application release
→ fresh target empty check + exact migration terminal check (必要时 replay active prefix)
→ generic pre-data-import preparation (清空 public/auth 应用数据，保留 migration ledger 与 provider metadata)
→ data-only DB restore (session_replication_role=replica 单事务导入并恢复 origin)
→ migration/constraint/FK/domain/identity verification
→ education retention reconciliation
→ Storage bucket/object restore with per-object read-back
→ final DB/domain/privacy verification
```

`roles.sql` 不由普通 isolated command 自动回放；Supabase managed roles/ownership 必须由目标 provider 的受支持 provisioning 路径提供。`schema.sql` 是 snapshot evidence，不是普通 restore 的 replay input；目标 schema 由当前兼容 shipped code 的 active Drizzle migration prefix 重建。这样保留 migrations-first 的 owner，同时明确 artifact 不是完全 self-contained 的 schema image。需要前进到当前版本时，另行运行正常 forward migration，再重复 verify。

### Restore verification scope

Verifier 至少检查：

- active Drizzle migration terminal、critical tables、primary/unique/check constraint validation 和所有相关 FK orphan；
- Auth 与 RivalHub identity 映射（active `public.users.auth_id IS NOT NULL → auth.users.id exists`，不采用脆弱的 user count equality 比较）、dangling reference、active primary/provider subject uniqueness、merge target、admin grant；
- CompetitionEntry、participant、roster revision、active claim、frozen EventRoster 的 scope coherence；
- StageRun/StageEntrant、Major match ownership、match/map/stats scope、FinalResult/honor coherence；
- education temporary evidence 的 retention predicate。

restore 后会复用应用 scheduler 的 canonical seven-day education retention algorithm：先删 Storage object，再清理 DB object key；CHSI code 清理与应用路径共用同一 policy。旧 snapshot 中已过期或已不再是 active DB reference 的 `education-evidence` object 不重新上传；它们的数量与字节会进入安全 summary，但不会成为 active evidence。

## Scheduler、配置与 application smoke

隔离恢复期间不 provision、enable 或 dispatch production scheduler，也不复制 Vault/root encryption/provider secret。顺序必须是：

```text
DB restore
→ disabled/not provisioned scheduler
→ schema/domain/identity verify
→ lifecycle/retention reconciliation
→ Storage restore
→ public/admin application smoke
→ external config presence verify（不打印 value）
→ protected secret/provider provisioning
→ scheduler provision/verify
→ enable normal operation
```

Application smoke 要用兼容 snapshot 的 shipped code，在专用 isolated URL 上完成 public read-model 与受控 admin/session 代表路径；不要把测试账号、session token、教育 evidence 或 raw response 写入 Issue/PR。验证还必须确认 target 使用了与 snapshot terminal 对应的 migration prefix，并检查 production 若存在 custom Auth/Storage trigger、RLS 或 policy 是否被迁移链重建。scheduler 只有在上述证据齐全后才允许由现有 protected owner provision。

## Incident decision table

| 事故 | 首选处理 |
| --- | --- |
| bad application deploy | exact shipped tag rollback/forward fix；不自动 restore DB |
| 可前向修复的 migration | compatible forward migration；不改写已发布 migration history |
| 单个用户/队伍误删 | isolated snapshot 查找事实，再调用 canonical correction owner；不整库回滚覆盖其它合法写入 |
| broad corruption/destructive migration | freeze mutation、保留证据、挑选 snapshot、isolated restore/verify，再制定单独 production recovery/cutover |
| provider outage | fail closed/degraded、沟通并等待 provider recovery；恢复后重新核对 consistency/config/scheduler |
| Auth/identity drift | 使用 restore verifier 分类，再走现有 canonical auth/login/self-heal/correction path；不建设长期第二套 audit/repair subsystem |

Production destructive restore、provider project cutover 和真实 incident freeze 都不属于普通 `db:recovery:*` 命令；必须另建 emergency approval path，确认 exact target、snapshot、write authorization、rollback/communication plan 后由 operator 执行。

## Rehearsal closeout

本演练必须在 recovery capability 的独立 patch release（PR `#577`）之后执行，并作为允许 destructive migration PR `#585` 合并/发布的前置条件；两者不得第一次共同进入同一 release。具体发布顺序由 [`operations/release.md`](release.md) 的 Recovery capability release gate 维护。

关闭 Issue 前的最低真实证据是：canonical production backup 成功并在 private R2 完成真实 GET 内容 hash read-back，使用离线 private key 解密，在 disposable isolated target 以 snapshot terminal 对应的 migration prefix restore，完成 DB/Auth/Storage/domain/privacy verification，以及兼容 shipped code 的 public/admin smoke。记录以下安全摘要即可：

```text
backup run identity（不含 private object key）
snapshot createdAt / verifiedAt
restore startAt / endAt
migration terminal tag
producer/source release identity
DB/object counts and byte totals（不含 row content/key）
verification result
measured RPO / RTO / target gap
isolated target cleanup result
```

不得把 raw dump、PII、signed URL、教育 evidence、object key 明文、secret 或 private key 作为 Issue/PR evidence。演练完成后删除解密目录、临时 Storage 内容、专用 isolated target 和本地临时凭据；R2 artifact 按 lifecycle/incident close policy 保留。
