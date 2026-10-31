# Release operations

RivalHub 使用 single-trunk + immutable tag。`main` 是唯一 releasable trunk；`vX.Y.Z` 或 semver prerelease tag 是 immutable release candidate / audit artifact，canonical Production `/api/system/release` 才是“哪个版本实际在线”的 authoritative runtime fact。本文件是 release procedure 的唯一 owner；协作与 Changeset 规则见 [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md)，可执行实现见 [`.github/workflows/release.yml`](../../.github/workflows/release.yml)。任何 release、tag、deploy 或 production mutation 前必须完整读取本文件。

## 1. Release PR

从最新 `main` 创建短期 release branch，消费待发布 Changesets：

```bash
pnpm exec changeset version
```

提交前确认 package version、CHANGELOG 分类/compare 链接、release-relevant feat/fix/security/migration 均准确；仍需 production/external acceptance 的事项必须保持未验收表述。Release PR 按普通 PR 进入 `main`，通过 required CI 后 squash merge。CHANGELOG 的 compare link 可以比较相邻 immutable tag，但正式 GitHub Release notes 必须覆盖真实 previous Production → current Production 的完整 delta；failed intermediate tag 不得被描述为曾经上线。

## 2. Release commit 与 tag

合并后从远端 `main` read back 实际 squash commit SHA，只在这个 commit 上创建 immutable `vX.Y.Z` 或显式 semver prerelease tag；普通 `main` merge 不会自动 production deploy。Release workflow 的 preflight 自动等待并验证该 exact commit 的 canonical CI workflow run（event=push, branch=main, head_sha=RELEASE_SHA）成功。

## 3. Protected Release workflow

Push tag 或显式 retry 已存在 tag 后，GitHub Actions **Release** 围绕同一个 immutable tag commit 执行：

```text
validate tag belongs to main
→ freeze previous Production identity (tag + commit)
→ generate machine-readable Release Plan from previousReleaseCommit → RELEASE_SHA
→ verify exact-SHA CI prerequisite (canonical push run on main = success)
├─ if migrationChanged: `db:check` + N/N+1 compatibility
├─ if migrationChanged: PostgreSQL 17 active-chain replay
├─ if irreversible migration: DB-only encrypted R2 checkpoint
├─ if release-time Storage mutation capability: full encrypted R2 checkpoint
└─ if fresh: staged candidate build/deploy
   ↓ all pre-promotion evidence complete
release lineage gate (`rivalhub-release-lineage`)
→ if requiresProductionMigration: production migration + verify
→ if requiresSteamProfileBackfill: protected Steam profile backfill → read-only coverage verify
→ if requiresStatsProjectionBackfill: protected per-map statistics backfill → read-only coverage verify
→ if fresh: Linux package verification → restart / smoke / rollback
→ if requiresSchedulerProvision: scheduler provision + verify
→ publish/update Production-delta GitHub Release notes
```

PG17 rehearsal、checkpoint 与 candidate build 在 preflight 完成后并行；candidate build 并行执行 Linux 恢复事务测试与制品构建，二者均成功才上传制品；它不等待数据库证据，也不在旧 schema 上做 runtime smoke。Release workflow 使用独立的 `rivalhub-release-lineage` workflow-level concurrency；其 `production_migration` job，以及仅在确实需要 scheduler provisioning 时的 `finalize` job，共享 `rivalhub-production-state-serialization` 与 daily backup，application-only release 不因 daily backup 排队。migration release 在 production migration/verify 完成后，先完成任何被 Release Plan 要求的 Steam profile backfill/coverage，再由同一 `finalize` job 执行 Linux 部署、smoke / routing、conditional scheduler 与 GitHub Release。

`scripts/release/plan.ts` 是 Release Plan 的唯一 owner。它只使用已冻结的 `previousReleaseCommit` 与当前 `RELEASE_SHA`，输出 `applicationChanged`、`migrationChanged`、`migrationRisk`、`storageMutationChanged`、`schedulerChanged`、`recoveryInfraChanged`、`releaseInfraChanged` 以及 `requiresMigrationRehearsal`、`requiresProductionMigration`、`requiresSteamProfileBackfill`、`requiresStatsProjectionBackfill`、`requiresCompetitiveProfileRepair`、`requiresDbCheckpoint`、`requiresFullCheckpoint`、`requiresSchedulerProvision`。当 `src/lib/competitive/profile-repair.ts` 变化时，`requiresCompetitiveProfileRepair=true`，在受保护数据库阶段运行 dry-run → only-missing apply → read-only verify；只有明确达成赛季但没有 season row 的有效 historical fact 可复制，已有冲突保留、每条修复原子写 audit，不更新 historical 或冻结赛事事实。无需 schema replay；zero eligible missing 才允许 candidate smoke/routing。当新增统计投影表或更新 `src/lib/stats/projection-version.ts` 时，`requiresStatsProjectionBackfill=true`，必须在 candidate smoke/routing 前经 protected wrapper 分图幂等回填并通过只读 coverage；缺失投影阻止切换，不把首次访客作为重建任务。仅算法版本变化也进入受保护的数据库阶段，但没有 schema 变化时不要求 migration rehearsal。详见 [`statistics-projections.md`](statistics-projections.md)。当 changed migration 创建 `steam_profiles` 时，`requiresSteamProfileBackfill=true`；该 gate 必须在 production migration/verify 后、candidate smoke/routing 前完成。`scripts/release/release-time-capabilities.json` 是 release-time capability 的显式声明：当前 `storageMutation=false`，只有 Release/operation 确实会不可逆写入既有 Production Storage object 时才允许改为 `true`；业务上传、Storage retention 或普通 source 变更不会通过路径推断触发 full checkpoint。无法识别的 migration SQL 按 `irreversible` 处理并要求 DB checkpoint；不根据 commit message 猜测风险。scheduler definition、provisioning/verification owner、cron/auth、相关 secret contract 或生产数据库目标 owner `scripts/db/production-environment.ts` 变化会触发 provision；生产项目 ref 切换必须在新目标重新 provision/verify，即使 scheduler definition 未变；现有 endpoint implementation、health/admin UI 不触发，canonical scheduler namespace 中无法识别的文件则 fail closed 到 provision。

BET 金融 subject 使用 reader-first upgrade。Release Plan 在任何 mutation 前，从同一 frozen previous Production commit 与 candidate commit 读取 `src/lib/bet/catalog-contract.json`；缺失声明视为旧 v1。Candidate publisher version 超过 previous reader version，或 candidate reader 低于 previous publisher version时，preflight fail closed。兼容读取版本须作为独立 Production release 先上线；将兼容 PR 与新 publisher PR 同时合并并一次发布仍会被拒绝。新 publisher 上线后，候选或回滚目标必须保留对应读取能力，不能退回兼容版本之前的应用。该门禁复用正式 Production identity，不依据 main ancestry、定时等待或 dirty 标记推断线上兼容性。独立金融功能可在同一 contract 的 `capabilities` 下声明各自 reader/publisher 版本，缺失声明视为 0/0；Release Plan 逐项执行相同门禁。全局或其他能力的 publisher 升级不授权未验收的独立能力，例如 BO3 新市场只使用 `bo3BpPresence` 专属 publisher 开关。金融 ledger kind 另外通过 `src/lib/bet/ledger-contract.json` 的独立 reader/publisher 维度校验（缺失声明视为 0/0）；market catalog、named capability 与 ledger 共用同一门禁，但不能互相授权新 producer。

Veto 申诉生命周期独立使用 `src/lib/matches/veto-room/lifecycle-contract.json` 的 reader/publisher 能力，缺失声明视为 0/0。reader1 必须同时理解 `closed` 说明和实际开赛后的恢复/裁定边界；publisher0 保留历史读取与安全保护，但不写新的 `closed`。publisher1 只有在冻结的真实 previous Production reader1 已上线后才可发布，可与下一阶段 BET 能力一起切换，不能由其它能力授权。`scripts/release/capability-contract.ts` 是这些 immutable Git contract 的共同读取/门禁 owner，Release Plan 与 routing 复用它。Routing 在 promotion 前、每次 mutation/retry 及补偿 rollback 前重新验证同一 frozen previous/candidate commit；contract 不兼容或无法读取时 fail closed。若候选可能已被 promote，补偿能力验证失败则不发送 rollback，保留 `capability_incompatible`、目标身份及可能副作用的诊断状态并要求人工介入；不得继续 scheduler/publish，也不得把口头“禁止回滚”作为此门禁的替代。

因此，application-only 或纯 release metadata 发布不会启动 PostgreSQL 17、Local Supabase、Storage snapshot、生产 migration 或备份；普通 source/migration 发布 也不会触发 full checkpoint，除非发布过程自身具备会不可逆修改既有 Production Storage object 的 release-time capability。破坏性/不可逆数据库变更要求 DB-only checkpoint。

关键安全与执行边界：

1. **Previous Production identity**：在任何 backup、migration、deploy 或 routing mutation 前，`scripts/release/production-identity.ts` 读取 canonical `/api/system/release`，冻结 `RIVALHUB_PREVIOUS_RELEASE_TAG` + `RIVALHUB_PREVIOUS_RELEASE_COMMIT`。Production path 后续的 migration compatibility、routing/rollback 与 release notes 必须消费同一组 pair，不得各自通过 Git tag history 重新推导 previous stable。
2. **Exact-SHA CI prerequisite**：Release 必须验证当前 immutable tag 对应的 `RELEASE_SHA` 在 `main` 上的 canonical CI push run 结果为 `completed && success`；在途 run 进行 bounded poll，missing/failed/cancelled/timed out 全部 fail closed。
3. **PG17 migration rehearsal**：`migration_rehearsal` job 使用 plain `postgres:17` service，调用 `pnpm db:release-rehearsal`；该入口复用 `preparePg17Database()` 与 `scripts/db/migration-replay.ts`。Release 的 `production_migration` 只有在该 job 成功后才传入受保护的 `RIVALHUB_RELEASE_MIGRATION_REHEARSAL=pg17`，由 `scripts/db/remote.ts` 跳过 legacy Local PostgreSQL replay，继续执行 production preflight、remote migrate 与 exact verify；直接/手工 production migration 不携带该 marker，仍保留 self-contained local replay safety path。对于 immutable tag 的 fresh `workflow_dispatch` retry，preflight 必须从 `refs/heads/main` 发起，并冻结当时的 exact `origin/main` HEAD 为 `releaseOperatorSha`；该 operator SHA 还必须拥有 canonical `main` push CI success evidence。`production_migration` 后续只 checkout 这份 frozen operator SHA，不再直接消费可变的 `github.sha`，并在远程写入前证明 tag 与 operator 的 candidate migration inputs 完全一致；tag push 的正常 release 仍使用 candidate tag。Release rehearsal 不启动 Local Supabase 的 Auth/Storage/browser 服务。
4. **Conditional recovery checkpoint**：`checkpoint` 是独立 protected job。DB-only checkpoint 只执行 logical DB dump、manifest/checksum、age 加密、private R2 PUT/HEAD/real GET read-back；full checkpoint 才读取 Storage inventory/objects。两者共用 `scripts/db/recovery/artifact.ts` 的 artifact/sidecar/completion owner。
5. **Hermetic production build**：`scripts/ci/hermetic-production-build.mjs` 在 CI 中真实走 `VERCEL_ENV=production` 的 `vercel.json → scripts/vercel-build.ts` 分支，注入有效的 synthetic release markers，并显式移除 DB/Supabase privileged credentials；该分支只构建，不连接 live production DB。DB compatibility、migration/verify 和 exact candidate smoke 分别由 Release workflow 的对应 gate 负责。
6. **Linux production deployment**：正式发布使用 Linux。`candidate_build` 在 Linux runner 的独立 clean worktree 构建 immutable tag，应用与 operator SHA 分别记录；tag retry 使用已验证的 frozen operator tooling。公开构建配置来自 production Environment variable `RIVALHUB_PRODUCTION_PUBLIC_CONFIGURATION`，仅接受 `production-config.mjs` allowlist。构建不消费 runtime secrets；服务端保留私有 runtime 配置，只更新 release markers。

   正式 Release 以 `build-production.mjs SOURCE --layers` 只生成 runtime/deps/app 三层制品；不传模式的手工打包入口继续生成完整 tar。分层 manifest 绑定 exact source/operator SHA、公开配置 hash、平台/架构、实际 Node 版本、完整组装树摘要及各层压缩字节数/归档 SHA/typed inventory/内容树摘要。finalize 通过固定 SSH 复核 `/opt/rivalhub-production/layers` 的每个缓存命中，只传缺失层，并记录实际传输压缩字节数；deps 按真实 standalone 文件识别，不能仅依据 lockfile。

   服务端先校验 manifest/归档 SHA 与 tar 路径、类型及相对链接，再解包到独立临时目录并重算内容树；复制组装全新、自包含的 release，规范化服务组读取/执行权限。保留 Next 生成的 app→deps 相对链接，并在完整组装后校验链接链不越出 release；不链接已安装版本或运行时 cache。完整树与 `standby.json` 身份校验通过才进入原安装事务；损坏缓存视为 miss，缺失/中断/校验失败不切换 current。缓存由部署 root 独占，只保存公开构建制品，不含 runtime secret、不备份、不作为回退依赖；首版不自动回收，可在无安装进行时删除后于下次部署重建。首次主机安装及历史制品继续使用完整 tar 入口，分层更新使用已安装 Node 引导。
7. **Promotion / rollback boundary**：Linux owner 为 `scripts/release/linux-routing.ts` 与 `scripts/standby/install-production.sh`。controller 在安装前仅核对 canonical previous identity 与 immutable capability contract，不要求旧版首页健康；候选和回退仍须通过 canonical identity 与首页健康检查。主机锁定安装事务并根据 current 指向的已安装 manifest 再次核对本机身份，保存旧包指针、环境与 service。身份核验成功后，installer 停止 `rivalhub-production`，用该版本现有 runtime DB 凭据执行 `production-quiescence.mjs`：读取真实 PostgreSQL application login/database 的 active、idle-in-transaction、aborted 与 prepared 事务，排除观察连接自身，要求相隔一秒的两次零观测，最长等待 60 秒（单次查询另有 5 秒限制）。服务停止同时阻断旧 HTTP action、Mizar ingress 与 HTTP cron/watchdog；pooler 后端仍有事务时不得仅凭进程退出继续切换。排空成功后才写新环境、unit、current 并启动 candidate，检查首页与 exact release identity。自动失败恢复与显式 rollback 也先停止当前 candidate 并完成同样排空，再恢复 previous。排空失败保留当前指针与配置、保持停机并报告失败，不自动杀事务、扩大 DB 权限或启动另一版。该过程会有短暂不可用，不同时运行两个生产实例。主机失败自动恢复；SSH 结果不明或公网 canonical 验证失败时，controller 重新验证 capability 后调用幂等回退并回读 previous identity。失败的 Release 不继续 scheduler/publish，不回滚数据库。
   数据迁移和恢复按各自操作文档处理；普通 patch 使用上述身份核验、服务停止、事务排空与回滚流程，不增加逐主机人工清单。

8. **Same-tag resume**：若某次 run 已完成 promote，canonical Production 已等于 candidate，但后续 scheduler 或 GitHub Release 步骤失败，retry 不得把 candidate 自己当作 previous，也不得重新执行 checkpoint/migration/deploy/routing。此时 workflow dispatch 必须显式提供首次 run 冻结的 `previous_release_tag` / `previous_release_commit`；脚本验证 canonical 已精确等于 candidate、previous pair 合法且位于 candidate ancestry 后设置 `RIVALHUB_RELEASE_MODE=resume`，仅继续幂等的 post-promotion 步骤。若 canonical 仍是旧版，则这些 resume inputs 反而是错误配置并 fail closed，正常走 fresh path。
9. **Protected Steam profile gate**：当 Release Plan 要求 backfill 时，production migration/verify 成功后必须使用 protected `STEAM_API_KEY` 和显式 cache-write confirmation 执行完整 current-primary backfill，再以 `REPEATABLE READ READ ONLY` coverage verify 确认 current-primary profile cache coverage；任一 provider、backfill 或 coverage failure 都阻止 candidate smoke/routing，旧 Production 保持为当前线上版本。
10. **Phase timing evidence**：各阶段耗时由 `scripts/ci/timing.mjs` 统一记录并写入 Step Summary，至少区分 Release Plan、bootstrap、PG17 replay、DB-only/full checkpoint、production migration、Steam profile backfill/coverage、candidate build/smoke、routing、scheduler、GitHub Release 与 Total。最终 publish job 使用调用 workflow 的 `github.run_started_at` 作为 `Total` 起点，覆盖 job waiting 与并行阶段。

production secrets、target confirmations 与 remote-write authorization 只存在于 protected production Environment/canonical wrappers。Linux 通过 `LINUX_DEPLOY_SSH_KEY` 与 `LINUX_DEPLOY_KNOWN_HOSTS` 连接固定主机 `47.103.131.158:52222`，严格校验已核实的 host key；本路径部署身份为 root，配置新凭据必须获得相应授权。禁止复用操作员个人私钥。runtime secrets 保留在服务器 `/etc/rivalhub-production/production.env`，不复制到 CI；安装权限及文件位置见 [standby.md](./standby.md)。

canonical domain 的 `/api/system/release` 必须严格只返回 `releaseTag`、`releaseCommit`，并精确等于 immutable tag 与 tag commit；失败阻止后续 release。要求 checkpoint 的 release 中，checkpoint 失败会阻止 production migration；没有相应 mutation 时不创建 checkpoint。

### Previous Production identity

正常 fresh release 中，`production-identity.ts` 的 canonical read-back 是本次 run 唯一的 previous Production snapshot，并在后续 step 中保持不变。failed stable-looking tag 只是 immutable release attempt artifact，不是 Production lineage；例如：

```text
v2.9.5 canonical Production
→ v2.9.6 tag exists, release failed before promote
→ v2.9.7 candidate
```

则 `v2.9.7` 的 previous Production 必须仍是 `v2.9.5`，migration compatibility 与 GitHub Release notes 都覆盖 `v2.9.5 → v2.9.7`。`RIVALHUB_PRODUCTION_STABLE_REF` 与 Git-derived recent-stable helper 仅供 developer/CI rehearsal 使用，Production Release 设置 explicit identity hard gate，不允许 silent fallback。

如果同一个 tag 已经完成 promote、canonical identity 已经是 candidate，canonical read-back 只能证明“candidate 已在线”，不能恢复 promote 之前的历史 baseline。因此 same-tag resume 要求 operator 从首次 run 的 freeze log/summary 提供原始 previous tag/SHA；这组值仅用于恢复该 immutable run 的历史 baseline，不成为新的 Production truth source，也不允许在 fresh path 覆盖 canonical read-back。

## 4. Recovery capability release gate

Recovery hardening 作为独立 release capability 进入 `main` 后，仍须完成一次真实 acceptance 才能关闭对应 Issue 或放行后续高风险 migration：

```text
production encrypted backup
→ private R2 artifact/sidecar/completion PUT + HEAD + real GET/hash read-back
→ offline read-only fetch
→ local offline age private key decrypt
→ disposable isolated target restore/verify/application smoke
```

active `education-evidence` business copy 继续是 7 天 retention；encrypted DR copy 最多 30 天，过期 evidence 不会在 restore 中重新激活。Recovery policy registry 允许 `team-logos` 与 `season-public-assets` durable/always，以及 `education-evidence` temporary-sensitive/active-reference-only；未知 bucket/type 必须 fail closed。`season-public-assets` 是公开赛事运营图片 bucket，用于赛事 Logo 与群二维码，migration、Storage verification 与 recovery inventory 必须共同证明其 public、1 MiB、JPEG/PNG/WebP contract。

## 5. 并发与重试

Release workflow 使用 `rivalhub-release-lineage` group，配置 `queue: max` 与 `cancel-in-progress: false`，保持 release 与 release 的 previous/candidate lineage 串行。`production_migration` job，以及 `requiresSchedulerProvision=true` 时的 `finalize` job，与 `recovery-backup.yml` 共享 `rivalhub-production-state-serialization`；不需要这些 production mutation 的 application-only release 不会因 daily backup 排队。`finalize` 在 fresh path 执行 exact candidate smoke → routing → conditional scheduler → GitHub Release，在 same-tag resume 中跳过 smoke/routing，但仍按 capability 重新 provision/verify scheduler 后才 publish；`recovery-r2.yml` 是独立 provider config verification workflow，不参与 DB serialization。

workflow dispatch 只能从当前 `main` HEAD 发起；preflight 会冻结该 operator SHA、验证其 canonical `main` push CI，并拒绝从其它 branch/ref 或过期 main SHA 发起的 retry。满足该 operator integrity gate 后，可以 retry 同一个已存在 tag，但分两种情况：

- canonical Production 仍是 previous release：不填写 `previous_release_tag` / `previous_release_commit`，按 fresh path 重新执行完整 release；
- canonical Production 已经是当前 candidate：必须填写首次 run 冻结的 previous pair，进入 `resume`，跳过已完成的 pre-promotion mutation，只重新执行 scheduler 与 GitHub Release 等 post-promotion steps。

不得移动 tag、手工 patch production DB、用未经验证的 local build 覆盖 production，或绕过 failed hard gate。

## 6. Cold-start 配置 read-back

Recovery acceptance 还要人工确认 Supabase plan/physical backup/PITR、Auth/API keys、Realtime、required DB extensions/settings、Storage config、GitHub Environment/secrets/vars、R2 30d lifecycle/lock/private domains 和 scheduler pg_cron/pg_net/Vault names。只记录 presence/owner/capability/retention，不记录 secret value、PII、signed URL 或 dump。Supabase database backup 不包含 Storage objects，provider clone/restore 后必须单独重建这些配置。

PostgreSQL TLS contract 由 `src/db/postgres-connection.ts` 统一维护，详见 `../deployment.md`；Hosted recovery/backup 只使用现代 `SUPABASE_SECRET_KEY`，不接受 legacy fallback；loopback Local Supabase adapter 保持独立。offline fetch 复用标准 R2 credential；该 credential 本身可能具备写权限，但 fetch path 只暴露 `HEAD/GET`，不调用 R2 write API，也不读取 DB、deploy 或 age private-key credential。

## 7. Release 完成条件

只有以下条件全部成立才算 release 完成：

- tag、实际 release commit、production deployment identity 对齐；
- previous Production tag/SHA 已冻结并校验，migration compatibility、routing 与 release notes 使用同一 baseline；
- Release Plan 要求的 DB-only 或 full checkpoint 已完成并通过 R2 HEAD/real GET/hash read-back；application-only、metadata-only、普通 source/migration 发布与普通 forward-compatible migration 不机械创建 full checkpoint；
- 仅在 Release Plan 标记时执行 production migration/verify、Steam profile backfill/coverage、scheduler provision/verify 或 Storage full checkpoint；若要求 Steam profile gate，则 backfill 与 read-only coverage verify 必须在 candidate smoke/routing 前成功；Linux 应用 smoke、canonical identity read-back 始终通过；
- GitHub Release notes 使用真实 previous Production → current Production delta，failed intermediate tag 不被表述为曾上线；
- Linux 的包、SSH 主机身份、主机 smoke 与恢复事务均已验证；
- 需要 production acceptance 的 Issue 具备真实 evidence 后再关闭。

Production destructive restore、provider cutover、incident freeze 和 Issue close 不是普通 release retry 的隐含副作用；必须满足各自明确授权与独立证据门槛。

### Statistics transport backfill

After a compatible release is serving Production, the separate manually dispatched
`Statistics transport backfill` workflow performs a bounded batch using the existing
production environment and protected database wrapper. It does not trigger a release.
See [statistics-projections.md](statistics-projections.md#protected-transport-backfill-runner)
for dispatch inputs, cursor recovery, verification limits and rollback semantics.
