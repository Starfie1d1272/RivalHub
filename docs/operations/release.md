# Release operations

RivalHub 使用 single-trunk + immutable tag。`main` 是唯一 releasable trunk；`vX.Y.Z` 或 semver prerelease tag 是 immutable release candidate / audit artifact，canonical Production `/api/system/release` 才是“哪个版本实际在线”的 authoritative runtime fact。本文件是 release procedure 的唯一 owner；协作与 Changeset 规则见 [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md)，可执行实现见 [`.github/workflows/release.yml`](../../.github/workflows/release.yml)。任何 release、tag、deploy 或 production mutation 前必须完整读取本文件。

## 1. Release PR

从最新 `main` 创建短期 release branch，消费待发布 Changesets：

```bash
pnpm exec changeset version
```

提交前确认 package version、CHANGELOG 分类/compare 链接、release-relevant feat/fix/security/migration 均准确；仍需 production/external acceptance 的事项必须保持未验收表述。Release PR 按普通 PR 进入 `main`，通过 required CI 后 squash merge。CHANGELOG 的 compare link 可以比较相邻 immutable tag，但正式 GitHub Release notes 必须覆盖真实 previous Production → current Production 的完整 delta；failed intermediate tag 不得被描述为曾经上线。

## 2. Release commit 与 tag

合并后从远端 `main` read back 实际 squash commit SHA，并确认该 exact commit 在 `main` 上的 canonical CI workflow run（event=push, branch=main, head_sha=RELEASE_SHA）已通过。只在这个 commit 上创建 immutable `vX.Y.Z` 或显式 semver prerelease tag；普通 `main` merge 不会自动 production deploy。即使提前打 tag，Release workflow 自身的 preflight 也会 machine-enforce 此项 exact-SHA prerequisite。

## 3. Protected Release workflow

Push tag 或显式 retry 已存在 tag 后，GitHub Actions **Release** 围绕同一个 immutable tag commit 执行：

```text
validate tag belongs to main
→ freeze previous Production identity (tag + commit)
→ verify exact-SHA CI prerequisite (canonical push run on main = success)
→ validate active migration chain (DB-only local rehearsal) + N/N+1 compatibility
→ fresh pre-release backup + R2 read-back
→ migrate + verify production database
→ deploy staged candidate to Vercel Production (--prod --skip-domain)
→ smoke exact candidate deployment (OIDC token)
→ invoke `scripts/release/routing.ts` (promote → alias convergence → canonical semantic convergence; rollback compensation on failure)
→ provision + verify production scheduler
→ publish/update Production-delta GitHub Release notes
```

关键安全与执行边界：

1. **Previous Production identity**：在任何 backup、migration、deploy 或 routing mutation 前，`scripts/release/production-identity.ts` 读取 canonical `/api/system/release`，冻结 `RIVALHUB_PREVIOUS_RELEASE_TAG` + `RIVALHUB_PREVIOUS_RELEASE_COMMIT`。Production path 后续的 migration compatibility、routing/rollback 与 release notes 必须消费同一组 pair，不得各自通过 Git tag history 重新推导 previous stable。
2. **Exact-SHA CI prerequisite**：Release 必须验证当前 immutable tag 对应的 `RELEASE_SHA` 在 `main` 上的 canonical CI push run 结果为 `completed && success`；在途 run 进行 bounded poll，missing/failed/cancelled/timed out 全部 fail closed。
3. **DB-only migration rehearsal**：本地 migration rehearsal 仅启动 PostgreSQL 容器（`pnpm db:local:start-db`），不启动 Local Supabase 的 Auth/Storage/browser 等无关服务；CI ephemeral runner 结束时自动回收容器，不再支付无意义的 stop 开销。
4. **Staged Production deployment**：使用 `vercel deploy --prod --skip-domain` 在 Production 环境完成构建，但不将生产域名指向该 candidate；先用短期 GitHub OIDC token 对 exact candidate URL 完成 `/` 与 `/api/system/release` smoke 验证。
5. **Promotion / rollback boundary**：Candidate smoke 通过后，唯一 executable owner `scripts/release/routing.ts`（workflow 通过 `pnpm release:routing` 调用）只消费 release 开始时冻结的 previous Production identity，并在任何 routing mutation 前冻结 previous deployment 与 candidate deployment 的 project/target/readiness。它通过 `scripts/release/vercel-routing.ts` 复用 Vercel REST API `POST /v10/projects/{projectId}/promote/{deploymentId}` 与 `POST /v1/projects/{projectId}/rollback/{deploymentId}`，不调用需要 user-scope lookup 的 CLI；promote 不触发二次构建。YAML 只负责 protected config 与 controller wiring。
6. **Same-tag resume**：若某次 run 已完成 promote，canonical Production 已等于 candidate，但后续 scheduler 或 GitHub Release 步骤失败，retry 不得把 candidate 自己当作 previous，也不得重新执行 backup/migration/deploy/routing。此时 workflow dispatch 必须显式提供首次 run 冻结的 `previous_release_tag` / `previous_release_commit`；脚本验证 canonical 已精确等于 candidate、previous pair 合法且位于 candidate ancestry 后设置 `RIVALHUB_RELEASE_MODE=resume`，仅继续幂等的 post-promotion 步骤。若 canonical 仍是旧版，则这些 resume inputs 反而是错误配置并 fail closed，正常走 fresh path。
7. **Phase timing evidence**：各阶段耗时由 `scripts/ci/timing.mjs` 统一记录并写入 Step Summary，包含 backup 内部子阶段（DB dump、Storage snapshot、encrypt/archive、R2 upload/readback）及各 deployment step。

production secrets、target confirmations 与 remote-write authorization 只存在于 protected production Environment/canonical wrappers。`VERCEL_TOKEN` 必须是 project-scoped credential，仅用于 exact production deployment、project-scoped promotion/rollback API calls；不得为了解决 CLI scope lookup 改用 Full Account/user/team token。Release job 使用 `id-token: write`，在运行时向 GitHub OIDC endpoint 申请短期 token，audience 为 `https://github.com/Starfie1d1272`；protected exact `https://<deployment>.vercel.app` smoke 只发送 `x-vercel-trusted-oidc-idp-token`。canonical `https://match.starfie1d.top` 使用普通 HTTPS read-back，不携带 OIDC header。

不得使用长期 bypass secret、Full Account/user/team token 或降低 Deployment Protection 代替 Trusted Source。deployment URL 与 canonical domain 的 `/api/system/release` 都必须严格只返回 `releaseTag`、`releaseCommit`，并精确等于对应 immutable tag 与 tag commit；任一失败都阻止后续 release。pre-release backup 失败会阻止 production migration。

### Previous Production identity

正常 fresh release 中，`production-identity.ts` 的 canonical read-back 是本次 run 唯一的 previous Production snapshot，并在后续 step 中保持不变。failed stable-looking tag 只是 immutable release attempt artifact，不是 Production lineage；例如：

```text
v2.9.5 canonical Production
→ v2.9.6 tag exists, release failed before promote
→ v2.9.7 candidate
```

则 `v2.9.7` 的 previous Production 必须仍是 `v2.9.5`，migration compatibility 与 GitHub Release notes 都覆盖 `v2.9.5 → v2.9.7`。`RIVALHUB_PRODUCTION_STABLE_REF` 与 Git-derived recent-stable helper 仅供 developer/CI rehearsal 使用，Production Release 设置 explicit identity hard gate，不允许 silent fallback。

如果同一个 tag 已经完成 promote、canonical identity 已经是 candidate，canonical read-back 只能证明“candidate 已在线”，不能恢复 promote 之前的历史 baseline。因此 same-tag resume 要求 operator 从首次 run 的 freeze log/summary 提供原始 previous tag/SHA；这组值仅用于恢复该 immutable run 的历史 baseline，不成为新的 Production truth source，也不允许在 fresh path 覆盖 canonical read-back。

### Release routing controller

`scripts/release/routing.ts` 是 release routing 的唯一 executable owner；`scripts/release/vercel-routing.ts` 是它使用的 Vercel provider adapter，不是额外的 workflow entrypoint。两者保留当前 production release endpoint、project-scoped Vercel credential 和 release identity contract；workflow 不再在 YAML/Bash 中复制 deployment parsing、alias wait、semantic smoke 或 rollback state machine。

provider adapter 为每个 HTTP request 设置 request-level timeout；GET 的 network failure、429 和选定的 5xx 只在有限 attempt 内重试，并与业务状态等待分开。Promote/rollback POST 只把 HTTP 201/202 视为 accepted；429 明确按 `Retry-After`/backoff 做一次 bounded retry，timeout/5xx 等 ambiguous outcome 则进入短的 bounded reconciliation observation window。完整 observation window 内持续观察 previous routing；只有窗口结束、至少有两次有效 observation 且全程都是 exact previous + succeeded、没有 transient/unknown/unrelated state 时才允许一次 retry；发现目标已被 provider 接受时立即 reconciled 且绝不重复 POST，observation 仍不明确则 fail closed。

promotion accepted 后，controller 分别等待 provider alias operation 和 canonical `/`、`/api/system/release`。HTTP 200 但 release identity 仍是合法旧值是 `not_converged`，不是立即失败；只有 exact `releaseTag`/`releaseCommit` 才算成功。provider alias convergence 保持 180 秒 deadline；canonical semantic convergence 使用独立的 120 秒 deadline，poll interval 为 2 秒，ambiguous reconciliation 默认 observation window 为 15 秒。malformed identity、401/403 和不可重试 provider contract 直接 fail fast，deadline 到期归类为 `convergence_timeout`。

promote 后的 terminal failure 会以 mutation 前冻结的 previous deployment 为唯一 rollback target。Rollback accepted 后仍必须等待 alias operation，并等待 canonical identity 精确恢复 previous tag/SHA；恢复未确认时 Release 保持 failed，controller 输出 `rollback_failed` 与人工介入提示，不继续 scheduler/GitHub Release，也不自动 reverse PostgreSQL migration。每次 controller run 都写入低敏 Step Summary，至少包含 candidate/previous deployment、promotion、canonical convergence、rollback outcome 和 terminal classification。

### Vercel Trusted Source（owner-only）

首次受保护 release 前，Vercel owner 必须在 `Settings → Deployment Protection → Trusted Sources → External Services → Add → GitHub Actions` 建立 Trusted Source。引导字段和 raw claims 使用以下真实值：

| Dashboard field | Value |
| --- | --- |
| GitHub account | `Starfie1d1272` |
| Repository | `RivalHub` |
| Branch | 留空（release 使用版本 tag） |
| GitHub Actions environment | `production` |
| Audience | `https://github.com/Starfie1d1272` |
| Applies to environments | `Production` |

issuer 固定为 `https://token.actions.githubusercontent.com`。切换 `Edit raw claims`，加入以下 exact matching claims（名称和值区分大小写）：

| Raw claim | Exact value |
| --- | --- |
| `aud` | `https://github.com/Starfie1d1272` |
| `repository` | `Starfie1d1272/RivalHub` |
| `repository_id` | `1231811932` |
| `workflow` | `Release` |
| `environment` | `production` |
| `sub` | `repo:Starfie1d1272/RivalHub:environment:production` |
| `event_name` | `push`, `workflow_dispatch` |

不填写 `ref` 或 `workflow_ref`：tag push 的 ref 是变量 `refs/tags/v<version>`，workflow dispatch 的 ref 也不是固定值，Trusted Source claim matching 使用 exact match。workflow 自己验证 tag commit 属于 `main`；Trusted Source 用 repository、repository id、workflow、environment、sub 和 event_name 收窄范围。代码只能申请 OIDC token 和发送 header，不能替代 owner Dashboard 配置；在 Dashboard 配置存在且 exact deployment smoke 真实通过前，protected smoke 保持未验收。

## 4. Recovery capability release gate

Recovery hardening 作为独立 release capability 进入 `main` 后，仍须完成一次真实 acceptance 才能关闭对应 Issue 或放行后续高风险 migration：

```text
production encrypted backup
→ private R2 artifact/sidecar/completion PUT + HEAD + real GET/hash read-back
→ offline read-only fetch
→ local offline age private key decrypt
→ disposable isolated target restore/verify/application smoke
```

active `education-evidence` business copy 继续是 7 天 retention；encrypted DR copy 最多 30 天，过期 evidence 不会在 restore 中重新激活。Recovery policy registry 允许 `team-logos` 与 `season-public-assets` durable/always，以及 `education-evidence` temporary-sensitive/active-reference-only；未知 bucket/type 必须 fail closed。`season-public-assets` 是公开赛事运营图片 bucket，当前用于群二维码，migration、Storage verification 与 recovery inventory 必须共同证明其 public、1 MiB、JPEG/PNG/WebP contract。

## 5. 并发与重试

`release.yml` 与 `recovery-backup.yml` 共享 `rivalhub-production-state-serialization` group，配置 `queue: max` 与 `cancel-in-progress: false`。这样 release migration 与 backup reference window 不会被互相取消或产生竞态覆盖；`recovery-r2.yml` 是独立 provider config verification workflow，不参与 DB serialization。

workflow dispatch 可以 retry 同一个已存在 tag，但分两种情况：

- canonical Production 仍是 previous release：不填写 `previous_release_tag` / `previous_release_commit`，按 fresh path 重新执行完整 release；
- canonical Production 已经是当前 candidate：必须填写首次 run 冻结的 previous pair，进入 `resume`，跳过已完成的 pre-promotion mutation，只重新执行 scheduler 与 GitHub Release 等 post-promotion steps。

不得移动 tag、手工 patch production DB、用未经验证的 local build 覆盖 production，或绕过 failed hard gate。

## 6. Cold-start 配置 read-back

Recovery acceptance 还要人工确认 Supabase plan/physical backup/PITR、Auth/API keys、Realtime、required DB extensions/settings、Storage config、Vercel Trusted Source、GitHub Environment/OIDC/secrets/vars、R2 30d lifecycle/lock/private domains 和 scheduler pg_cron/pg_net/Vault names。只记录 presence/owner/capability/retention，不记录 secret value、PII、signed URL 或 dump。Supabase database backup 不包含 Storage objects，provider clone/restore 后必须单独重建这些配置。

这次变更不迁移 PostgreSQL TLS 配置，不把现有 `service_role` 变量做全仓库改名或权限扩大；recovery/backup 只使用现代 `SUPABASE_SECRET_KEY`，并为既有配置保留明确的 legacy fallback。offline fetch 复用标准 R2 credential；该 credential 本身可能具备写权限，但 fetch path 只暴露 `HEAD/GET`，不调用 R2 write API，也不读取 DB、deploy 或 age private-key credential。

## 7. Release 完成条件

只有以下条件全部成立才算 release 完成：

- tag、实际 release commit、production deployment identity 对齐；
- previous Production tag/SHA 已冻结并校验，migration compatibility、routing 与 release notes 使用同一 baseline；
- pre-release backup、R2 HEAD/real GET/hash read-back 通过（same-tag `resume` 复用首次已完成 run 的该阶段，不重复写）；
- production migration/verify、Vercel protected smoke、canonical identity read-back、scheduler provision/verify 通过；
- GitHub Release notes 使用真实 previous Production → current Production delta，failed intermediate tag 不被表述为曾上线；
- Vercel Trusted Source 已由 owner 配置并以短期 GitHub OIDC exact deployment smoke 证明；
- 需要 production acceptance 的 Issue 具备真实 evidence 后再关闭。

Production destructive restore、provider cutover、incident freeze 和 Issue close 不是普通 release retry 的隐含副作用；必须满足各自明确授权与独立证据门槛。
