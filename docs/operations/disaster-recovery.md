# Disaster recovery

本页是 RivalHub production 数据恢复的 canonical runbook。代码 owner 位于 [`scripts/db/recovery/`](../../scripts/db/recovery/)，本页只规定边界、证据和操作顺序，不保存 PII、signed URL、object key 明文、secret 或 private key。

## 目标与当前边界

RivalHub 使用 Recovery format 2 的全量 logical snapshot：production Supabase 数据库与真实 Storage objects 共享一个 run identity，runner 在临时目录生成明文、计算 checksum、压缩后用 age 公钥加密，最后只上传 private Cloudflare R2 中的 encrypted artifact、sidecar manifest 和 completion marker。`producer` 是生成工具的 code/package identity；`source` 是备份时 production 实际部署的 release/commit 与 database migration terminal；两者可以不同。

目标窗口如下，但在第一次真实 production snapshot → isolated restore rehearsal 完成前，achievable RPO/RTO 仍是 `unknown / unverified`：

| 场景 | Target RPO | Target RTO |
| --- | ---: | ---: |
| 报名截止、抽签、比赛进行中等关键赛事窗口 | ≤ 1h | ≤ 2h |
| 普通非赛事窗口 | ≤ 6h | ≤ 8h |

数据库 dump 与 Storage inventory/download 是顺序操作，不是跨系统原子快照；`createdAt` 是 run identity，不代表严格 point-in-time。backup 在 database dump 前由 [`storage-policy.ts`](../../scripts/db/recovery/storage-policy.ts) 读取 managed references，Storage snapshot 完成后再次读取；两次 reference set 必须 exact equal，且第一组 references 必须全部出现在同一份 Storage inventory 中，否则整个 run fail closed。

## Owner 与 artifact

| Owner | 作用 |
| --- | --- |
| `.github/workflows/recovery-backup.yml` | 每小时 UTC 第 17 分钟执行，并支持受保护的 daily/manual dispatch |
| `.github/workflows/release.yml` | production migration 前执行 `pre-release` backup hard gate |
| `scripts/db/recovery/backup.ts` | 唯一 logical backup、Storage snapshot、age、R2 PUT/HEAD/GET read-back 与 heartbeat owner |
| `scripts/db/recovery/storage-policy.ts` | Storage recovery policy 与 managed DB reference owner |
| `scripts/db/recovery/r2-config.ts` | R2 lifecycle、per-class bucket lock、private-access provider contract owner |
| `scripts/db/recovery/fetch.ts` | offline R2 read-only completion → sidecar → artifact fetch owner，不解密、不连接数据库 |
| `scripts/db/recovery/restore.ts` | 仅允许 isolated target 的解密与恢复入口 |
| `scripts/db/recovery/verify.ts` | migration、constraint、FK、identity、entry/roster、stage/match/result/honor、retention invariant verifier |
| `scripts/db/recovery/lifecycle.ts` | isolated restore 后复用应用 scheduler 的 education retention algorithm |

artifact 逻辑内容为：

```text
backup/
├── roles.sql
├── schema.sql
├── data.sql
├── storage/
│   ├── buckets.json
│   ├── index.ndjson
│   └── objects/*.bin
└── manifest.json
```

`manifest.json` 包含 format version、UTC 时间、固定 production project identity、PostgreSQL/Supabase CLI identity、SQL digest、Storage count/bytes/inventory digest 和 backup class。Storage private object key 只存在于 encrypted artifact 的 `index.ndjson`，不进入 CI summary、Issue、PR 或 heartbeat。

## Storage policy 与 retention 语义

Storage inventory 只接受 `STANDARD` bucket，并且每个 bucket 必须命中以下 registry；缺失 type、unsupported type 或未知 bucket 一律 fail closed：

| Bucket | Recovery class | Restore mode | 语义 |
| --- | --- | --- | --- |
| `team-logos` | `durable` | `always` | 作为长期业务资产恢复 |
| `education-evidence` | `temporary-sensitive` | `active-reference-only` | 只恢复恢复后数据库仍 active reference 的 object |

`education-evidence` 的 active business copy 仍由应用 canonical retention policy 管理：审核完成后 7 天清理，顺序是先删 Storage object、再清空数据库 reference。private encrypted DR copy 最多按 `production/daily/`、`production/pre-release/`、`production/manual/` 的 30 天 retention 保留；这只是恢复证据窗口，不延长 active business copy 的生命周期。恢复时，snapshot 中已过期或已不再是 active reference 的 evidence 永远不会重新上传或重新激活，只在安全 summary 中计数。

backup 不直接写 education-specific SQL。所有 managed references 必须经过 policy owner；未来新增 bucket 先新增 registry、reference owner 和正反例测试，再允许进入 snapshot/restore。

## Provider 配置与凭据

GitHub `production` job 读取以下名称；值不得写入仓库、Issue、PR、CI summary 或日志：

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `DATABASE_URL` | secret | production runtime/migration 使用的 Transaction Pooler URL（`:6543 / pgbouncer=true`） |
| `RIVALHUB_PRODUCTION_BACKUP_DATABASE_URL` | secret，可选 | 经过固定 project/host 校验的 Session Pooler（`:5432`）backup connection；缺省从 `DATABASE_URL` 派生 |
| `SUPABASE_SECRET_KEY` | secret | backup 的 canonical Supabase API credential；脚本只执行受控 dump/Storage read |
| `SUPABASE_SERVICE_ROLE_KEY` | secret，legacy fallback，可选 | 只兼容已有配置；新 recovery 配置不要求创建，不能借此扩大全仓库 migration |
| `RIVALHUB_BACKUP_AGE_RECIPIENT` | environment variable | backup runner 只能使用的 age 公钥 |
| `RIVALHUB_BACKUP_HEARTBEAT_URL` | secret | Better Stack heartbeat URL；不得记录 URL 或 token |
| `RIVALHUB_PRODUCTION_BASE_URL` | environment variable | canonical production HTTPS origin 与 release identity read-back |
| `RIVALHUB_R2_ACCOUNT_ID` / `RIVALHUB_R2_BUCKET` | environment variables | private recovery bucket identity |
| `RIVALHUB_R2_ACCESS_KEY_ID` / `RIVALHUB_R2_SECRET_ACCESS_KEY` | secrets | 仅 backup writer；由 bucket-scoped R2 credential 提供 |
| `CLOUDFLARE_API_TOKEN` | secret | 仅 R2 retention workflow 的 provider read/apply |
| `VERCEL_TOKEN` | secret | project-scoped deploy credential，仅 release deploy |

这次 hardening 不进行 PostgreSQL TLS 设置迁移，也不进行 `service_role` 全仓库改名或权限扩大；现有 backup connection 的 TLS 行为保持其既有 owner。`db:recovery:fetch` 另用 offline kit 的 `RIVALHUB_R2_READ_ACCESS_KEY_ID`、`RIVALHUB_R2_READ_SECRET_ACCESS_KEY`、`RIVALHUB_R2_ENDPOINT`，并拒绝携带 writer、database、Supabase 或 age identity credential。

age private key 只保存在离线 recovery kit/password manager。它不能进入 GitHub Environment、仓库或 R2；只在本地 isolated restore 时短暂提供给 `restore.ts`。

### Vercel Trusted Source（owner-only）

首次受保护 release 前，Vercel owner 必须在 `Settings → Deployment Protection → Trusted Sources → External Services → Add → GitHub Actions` 建立 Trusted Source。引导字段为：

| Dashboard field | Value |
| --- | --- |
| GitHub account | `Starfie1d1272` |
| Repository | `RivalHub` |
| Branch | 留空（release 使用版本 tag） |
| GitHub Actions environment | `production` |
| Audience | `https://github.com/Starfie1d1272` |
| Applies to environments | `Production` |

issuer 固定为 `https://token.actions.githubusercontent.com`。切换 `Edit raw claims`，加入以下 exact values：

| Raw claim | Exact value |
| --- | --- |
| `aud` | `https://github.com/Starfie1d1272` |
| `repository` | `Starfie1d1272/RivalHub` |
| `repository_id` | `1231811932` |
| `workflow` | `Release` |
| `environment` | `production` |
| `sub` | `repo:Starfie1d1272/RivalHub:environment:production` |
| `event_name` | `push`, `workflow_dispatch` |

不填写 `ref` 或 `workflow_ref`，因为版本 tag 与手动 dispatch ref 都是变量；代码只能申请短期 OIDC token，不能代替 owner Dashboard 配置。

## Better Stack backup heartbeat

Better Stack monitor 的 token URL 存在 `RIVALHUB_BACKUP_HEARTBEAT_URL`。backup 只有在 artifact、sidecar、completion 三个 object 都完成 PUT、HEAD metadata/size、真实 GET 内容 hash read-back 后，才发送 success heartbeat。任一前置步骤或 success heartbeat 失败，runner 尝试访问同一 endpoint 的 `/fail`，failure 请求不带原始 error/body/secret；原始 backup error 仍按既有脱敏规则处理。

GitHub scheduled workflow 可能延迟或丢失，不能单独证明 RPO 或 backup freshness；Better Stack heartbeat 才是持续 freshness evidence。monitor 必须由 owner 配置 expected period 与 grace/no-start timeout，使“没有开始/没有成功 heartbeat”在一个有界窗口内触发 incident；heartbeat 网络请求本身也有 10 秒 timeout。具体 endpoint 与 `/fail` 语义以 [Better Stack heartbeat documentation](https://betterstack.com/docs/uptime/cron-and-heartbeat-monitor/) 为准。heartbeat 是告警证据，不替代 R2 read-back。

## R2 retention contract

首次配置或变更时，在 production Environment approval 下运行 `.github/workflows/recovery-r2.yml` 的 `apply`；日常/变更后运行 `verify` 做 provider read-back。脚本先严格读取并验证 Cloudflare GET shape，再读取既有 rules，保留真正不重叠的 unrelated rules；未知或冲突的 production-overlapping delete/lock rule 一律拒绝覆盖。

Cloudflare 默认的 `Default Multipart Abort Rule` 只清理 incomplete multipart upload，不等同于 completed-object deletion，因此不会被误判为缩短 recovery artifact retention。任何 `deleteObjectsTransition` 才是 completed-object deletion；未知 lifecycle shape、unsupported expiration semantics、重复 rule id、无效 lock condition、无效 domains response 都 fail closed。managed domain 必须明确返回 `bucketId`、`domain`、`enabled`，custom domains 必须返回带 boolean `enabled` 的 `domains` 数组；不能用缺字段或 fallback 空数组证明 private。

期望规则为每个 backup class 同时设置 lifecycle 与 bucket lock：

| Class | Prefix | Lifecycle delete | Bucket lock |
| --- | --- | ---: | ---: |
| hourly | `production/hourly/` | 48h | 48h |
| daily | `production/daily/` | 30d | 30d |
| pre-release | `production/pre-release/` | 30d | 30d |
| manual | `production/manual/` | 30d | 30d |

不存在 generic `production/` 7-day lock。字段与 API payload 以 [Cloudflare R2 Lifecycle API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/lifecycle/)、[Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) 和 [Bucket Lock API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/locks/) 为准。R2 lifecycle、lock 与 private-access state 在首次真实 `verify` 前仍是 `unverified`，仓库常量不能替代 provider read-back。

release、scheduled backup、R2 retention workflow 共享 `rivalhub-production-state-serialization` concurrency group，配置 `queue: max`、`cancel-in-progress: false`；任一 workflow 不得使用 cancel-in-progress true。这样不会在 backup reference read-back/dump 与 production migration 或 provider retention apply 之间制造取消/覆盖竞态。并发语义以 [GitHub Actions concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) 为准。

## Backup 命令与失败语义

普通本地 shell 不应运行 production backup。受保护 workflow 调用：

```bash
pnpm db:recovery:backup hourly
pnpm db:recovery:backup daily
pnpm db:recovery:backup manual
pnpm db:recovery:backup pre-release
```

命令必须通过 production target/project/host/URL、Session Pooler、Supabase key、age recipient、R2 writer 与 heartbeat 校验；它不要求 remote DB write authorization，也不执行 application mutation。任何 database dump、policy-owned reference read、Storage snapshot、加密、R2 PUT/HEAD/real GET/hash read-back 或 success heartbeat 失败，整个 run 失败且不得产生可信 completion 状态；workflow 不上传明文 Actions artifact。

## Offline read-only fetch

在与 GitHub/production credentials 隔离的机器上，使用独立 R2 Object Read-only credential：

```bash
export RIVALHUB_R2_ACCOUNT_ID='...'
export RIVALHUB_R2_BUCKET='rivalhub-recovery'
export RIVALHUB_R2_ENDPOINT='https://<account>.r2.cloudflarestorage.com'
export RIVALHUB_R2_READ_ACCESS_KEY_ID='...'
export RIVALHUB_R2_READ_SECRET_ACCESS_KEY='...'
unset RIVALHUB_R2_ACCESS_KEY_ID RIVALHUB_R2_SECRET_ACCESS_KEY
unset DATABASE_URL SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY RIVALHUB_BACKUP_AGE_IDENTITY_FILE
unset RIVALHUB_RECOVERY_DATABASE_URL RIVALHUB_RECOVERY_SUPABASE_URL RIVALHUB_RECOVERY_SERVICE_ROLE_KEY
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_SECURITY_TOKEN AWS_PROFILE

pnpm db:recovery:fetch \
  --completion-key production/manual/YYYY-MM-DD/<run-uuid>.complete.json \
  --output /private/path/new-recovery-run
```

fetch 固定按 completion → sidecar → encrypted artifact 顺序执行 HEAD/真实 GET 与 checksum 验证，核对 run identity、artifact size/hash 和 sidecar/completion relationship；只把三个已验证文件放进一个全新的 `0700` 目录，拒绝覆盖已存在目录。它不连接 PostgreSQL/Supabase，不调用 Cloudflare configuration API，不执行 PUT，不读取 age private key，也不解密 artifact。

## Format compatibility baseline

Recovery format 遵循 **read-new-before-write-new**：任何未来 writer format `N+1` 只能在 reader、fetch、restore 和 compatibility regression 已经接受 `N+1` 后才允许改变 writer constant；没有兼容 reader 就不得产生新 artifact。当前 writer/reader 都是 format 2，`manifest.ts` 在 backup/fetch/restore 入口执行 compatibility guard。

## Isolated restore

普通 restore 只接受显式 isolated loopback target；代码没有 production destructive restore command。最小环境如下：

```bash
export RIVALHUB_RECOVERY_TARGET=isolated
export RIVALHUB_RECOVERY_DATABASE_URL='postgresql://...@127.0.0.1:.../postgres'
export RIVALHUB_RECOVERY_SUPABASE_URL='http://127.0.0.1:54321'
export RIVALHUB_RECOVERY_PUBLISHABLE_KEY='...'
export RIVALHUB_RECOVERY_SERVICE_ROLE_KEY='...'
export RIVALHUB_BACKUP_AGE_IDENTITY_FILE='/private/path/recovery-identity.txt'
unset RIVALHUB_ALLOW_REMOTE_DB_WRITE
```

restore 必须运行在 exact shipped tag 的兼容 application release；它按 snapshot 的 migration terminal 截取 active prefix，不自动推进 fresh target，也不 downgrade 既有 ledger。目标已有 application/Auth/Storage rows 或 Drizzle migrations 时拒绝继续，必须换 disposable target。

```bash
pnpm db:recovery:restore \
  --artifact /private/path/new-recovery-run/artifact.tar.gz.age \
  --manifest /private/path/new-recovery-run/sidecar.json \
  --completion /private/path/new-recovery-run/completion.json
```

顺序固定为：

```text
sidecar/completion/artifact checksum
→ age decrypt + safe archive inspection
→ format/source identity + compatible shipped release
→ fresh target empty check + exact migration prefix
→ DB data restore + migration/constraint/FK/domain/identity verification
→ canonical education retention reconciliation
→ policy-driven Storage bucket/object restore + per-object read-back
→ final DB/domain/privacy verification + application smoke
```

`roles.sql` 只作审查证据，不由普通 isolated command 自动回放；`schema.sql` 也不是 replay input，目标 schema 由 active migration prefix 重建。恢复后的 active business copy 继续遵守 7 天 policy；旧 snapshot 中过期或失去 active reference 的 temporary-sensitive evidence 不重新激活。

隔离恢复期间 scheduler 保持 disabled/not provisioned，不复制 Vault/root encryption/provider secret，也不 dispatch production endpoint。应用 smoke 只使用与 snapshot terminal 兼容的 shipped code 和 isolated URL，至少覆盖 public read-model 与受控 admin/session 代表路径；scheduler 只有在 DB/domain/privacy、Storage 和 config presence 证据齐全后，才由现有 protected owner 最后 provision/verify。

Verifier 复用现有 canonical owner，至少检查 migration terminal、关键约束/FK、Auth ↔ canonical identity、CompetitionEntry/roster、Stage/Match/FinalResult coherence，以及 education evidence retention predicate；`SELECT 1`、首页 HTTP 200 或 `auth.users` 与 `public.users` 数量相等都不能单独作为 restore success。

## Cold-start provider configuration inventory

真实恢复 acceptance 还必须人工 read back 下列 provider/config presence；只记录存在性、owner、版本/plan、capability 和 retention，不记录 secret value、用户数据或下载内容：

| System | Cold-start inventory |
| --- | --- |
| Supabase | project/plan；physical backup/PITR capability 与 retention；Auth settings/API keys；Realtime settings；required DB extensions/settings；Storage bucket/config；Edge Functions/triggers/policies |
| Cloudflare R2 | account/bucket identity；per-class lifecycle/lock；managed/custom domain disabled；read-only fetch credential owner |
| Vercel | project/Production target；Trusted Source issuer/audience/claims；deployment protection remains enabled |
| GitHub | `production` Environment；required secrets/vars presence；OIDC `id-token: write`；release/recovery workflow permissions；concurrency group |
| Better Stack | backup heartbeat monitor URL owner；expected period；grace/no-start timeout；failure notification route |
| Scheduler | pg_cron/pg_net capability；named schedules；Vault secret names；provision/verify owner |

Supabase database backup 不包含 Storage objects；clone/restore 还需人工重建上述 Storage/Auth/Realtime/extension/provider 配置。没有 provider read-back 时，不能把 automatic backup、PITR、scheduler 或 cutover 写成已可用；R2 logical snapshot 也不能代替 provider physical backup。

## Rehearsal 与关闭条件

Issue 只有在以下真实 evidence 全部完成后才允许关闭：

```text
production encrypted backup
→ private R2 artifact/sidecar/completion PUT + HEAD + real GET/hash read-back
→ Better Stack success heartbeat
→ offline read-only fetch
→ 离线 private key 解密
→ disposable isolated target restore/verify
→ policy-driven Storage restore、retention/privacy verification
→ compatible shipped code public/admin smoke
→ measured RPO/RTO 与 target gap
```

记录安全摘要即可：run identity、snapshot/restore 时间、migration terminal、producer/source identity、DB/object count/bytes、verification、heartbeat 状态、RPO/RTO、isolated target cleanup。不得把 raw dump、PII、教育 evidence、object key 明文、secret 或 private key 作为 Issue/PR evidence。Production destructive restore、provider cutover 和 incident freeze 仍须另建 emergency approval path；普通 `db:recovery:*` 命令永远不承担这些写操作。
