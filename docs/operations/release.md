# Release operations

RivalHub 使用 single-trunk + immutable tag。`main` 是唯一 releasable trunk；只有 `vX.Y.Z` 或 prerelease tag 表示 shipped production identity。本文件是 release procedure 的唯一 owner；协作与 Changeset 规则见 [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md)，可执行实现见 [`.github/workflows/release.yml`](../../.github/workflows/release.yml)。任何 release、tag、deploy 或 production mutation 前必须完整读取本文件。

## 1. Release PR

从最新 `main` 创建短期 release branch，消费待发布 Changesets：

```bash
pnpm exec changeset version
```

提交前确认 package version、CHANGELOG 分类/compare 链接、release-relevant feat/fix/security/migration 均准确；仍需 production/external acceptance 的事项必须保持未验收表述。Release PR 按普通 PR 进入 `main`，通过 required CI 后 squash merge。新版本 compare link 必须比较紧邻的 immutable tag，已发布 tag 不移动。

## 2. Release commit 与 tag

合并后从远端 `main` read back 实际 squash commit SHA，并确认该 exact commit 的完整 convergence CI 通过。只在这个 commit 上创建 immutable `vX.Y.Z` 或显式 semver prerelease tag；普通 `main` merge 不会自动 production deploy。

## 3. Protected Release workflow

Push tag 或显式 retry 已存在 tag 后，GitHub Actions **Release** 围绕同一个 immutable tag commit 执行：

```text
validate tag belongs to main
→ validate active migration chain + previous-release compatibility
→ fresh pre-release backup + R2 read-back
→ migrate + verify production database
→ deploy exact tag commit to Vercel Production
→ protected deployment smoke + canonical production identity read-back
→ provision + verify production scheduler
→ publish/update GitHub Release notes
```

production secrets、target confirmations 与 remote-write authorization 只存在于 protected production Environment/canonical wrappers。`VERCEL_TOKEN` 必须是 project-scoped deploy credential，只负责 exact production deploy。Release job 使用 `id-token: write`，在运行时向 GitHub OIDC endpoint 申请短期 token，audience 为 `https://github.com/Starfie1d1272`；protected exact `https://<deployment>.vercel.app` smoke 只发送 `x-vercel-trusted-oidc-idp-token`。canonical `https://match.starfie1d.top` 使用普通 HTTPS read-back，不携带 OIDC header。

不得使用长期 bypass secret、Full Account/user/team token 或降低 Deployment Protection 代替 Trusted Source。deployment URL 与 canonical domain 的 `/api/system/release` 都必须严格只返回 `releaseTag`、`releaseCommit`，并精确等于当前 immutable tag 与 tag commit；任一失败都阻止后续 release。pre-release backup 失败会阻止 production migration。

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

不填写 `ref` 或 `workflow_ref`：tag push 的 ref 是变量 `refs/tags/v<version>`，workflow dispatch 的 ref 也不是一个固定值，Trusted Source claim matching 是 exact match。workflow 自己验证 tag commit 属于 `main`；Trusted Source 用 repository、repository id、workflow、environment、sub 和 event_name 收窄范围。代码只能申请 OIDC token 和发送 header，不能替代 owner Dashboard 配置；在 Dashboard 配置存在且 exact deployment smoke 真实通过前，protected smoke 保持未验收。

## 4. Recovery capability release gate

Recovery hardening 作为独立 release capability 进入 `main` 后，仍须完成一次真实 acceptance 才能关闭对应 Issue 或放行后续高风险 migration：

```text
production encrypted backup
→ private R2 artifact/sidecar/completion PUT + HEAD + real GET/hash read-back
→ offline read-only fetch
→ local offline age private key decrypt
→ disposable isolated target restore/verify/application smoke
```

active `education-evidence` business copy 继续是 7 天 retention；encrypted DR copy 最多 30 天，过期 evidence 不会在 restore 中重新激活。Recovery policy registry 只允许 `team-logos` durable/always 与 `education-evidence` temporary-sensitive/active-reference-only；未知 bucket/type 必须 fail closed。

## 5. 并发与重试

`release.yml` 与 `recovery-backup.yml` 共享 `rivalhub-production-state-serialization` group，配置 `queue: max` 与 `cancel-in-progress: false`。这样 release migration 与 backup reference window 不会被互相取消或产生竞态覆盖；`recovery-r2.yml` 是独立的 provider 配置校验工作流，不参与数据库串行排队。workflow dispatch 可重试同一个已存在 tag 或对应操作；不得移动 tag、手工 patch production DB、用未经验证的本地 build 覆盖 production，或绕过 failed hard gate。

## 6. Cold-start 配置 read-back

Recovery acceptance 还要人工确认 Supabase plan/physical backup/PITR、Auth/API keys、Realtime、required DB extensions/settings、Storage config、Vercel Trusted Source、GitHub Environment/OIDC/secrets/vars、R2 30d lifecycle/lock/private domains 和 scheduler pg_cron/pg_net/Vault names。只记录 presence/owner/capability/retention，不记录 secret value、PII、signed URL 或 dump。Supabase database backup 不包含 Storage objects，provider clone/restore 后必须单独重建这些配置。

这次变更不迁移 PostgreSQL TLS 配置，不把现有 `service_role` 变量做全仓库改名或权限扩大；recovery/backup 只使用现代 `SUPABASE_SECRET_KEY`，并为既有配置保留明确的 legacy fallback。offline fetch 复用标准 R2 credential 但代码路径严格只读，绝不读取 deploy/write/decrypt credential。

## 7. Release 完成条件

只有以下条件全部成立才算 release 完成：

- tag、实际 release commit、production deployment identity 对齐；
- pre-release backup、R2 HEAD/real GET/hash read-back 通过；
- production migration/verify、Vercel protected smoke、canonical identity read-back、scheduler provision/verify 通过；
- GitHub Release notes 与 compare link 正确；
- Vercel Trusted Source 已由 owner 配置并以短期 GitHub OIDC exact deployment smoke 证明；
- 需要 production acceptance 的 Issue 具备真实 evidence 后再关闭。

Production destructive restore、provider cutover、incident freeze 和 Issue close 不是普通 release retry 的隐含副作用；必须满足各自明确授权与独立证据门槛。
