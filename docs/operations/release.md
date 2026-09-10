# Release operations

RivalHub 使用 single-trunk + immutable tag。`main` 是唯一 releasable trunk；只有 `vX.Y.Z` / prerelease tag 表示 shipped production identity。

本文件是 release procedure 的唯一 owner。协作与 Changeset 规则见 [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md)；可执行实现见 [`.github/workflows/release.yml`](../../.github/workflows/release.yml)。任何 release / tag / deploy / production mutation 前必须完整读完本文件；repository search / `rg` 只能用于定位，不能替代全文读取。

## 1. Release PR

从最新 `main` 创建短期 release branch，消费待发布 Changesets：

```bash
pnpm exec changeset version
```

提交 PR 前确认：

- `package.json` version 正确，未手工维护第二份版本号；
- `changeset version` 产物只作初稿：按仓库既有 CHANGELOG 结构整理当前版本，按实际内容使用 `Added` / `Changed` / `Fixed` 等分类和必要的中文主题，合并重复条目、删除内部实现噪音，不保留 `Patch Changes` / `Minor Changes` / `Major Changes` 等默认标题；
- release-relevant feat / fix / security / migration 无遗漏；
- CHANGELOG 底部存在当前版本 compare 链接，例如 `[X.Y.Z]: https://github.com/Starfie1d1272/RivalHub/compare/vPREVIOUS...vX.Y.Z`；
- 仍需 production / external acceptance 的事项已明确，不把未验收状态写成已完成。

Release PR 按普通 PR 进入 `main`，通过 required CI 后 squash merge。

## 2. Release commit 与 tag

合并后从远端 `main` read back 实际 squash commit SHA，并确认该 commit 的完整 convergence CI 通过。

只在这个 exact commit 上创建 immutable tag：stable 使用 `vX.Y.Z`，prerelease 使用显式 semver suffix。已公开 stable tag 不移动、不删除。普通 `main` merge 不会自动 production deploy。

## 3. Protected Release workflow

Push tag 后，GitHub Actions **Release** 围绕同一个 immutable tag commit 执行：

```text
validate tag belongs to main
→ validate active migration chain locally
→ validate previous-release compatibility
→ create + verify fresh pre-release backup
→ migrate + verify production database
→ deploy exact tag commit to Vercel Production
→ smoke deployment + canonical production domain，并从两者读回 exact release identity
→ provision + verify Supabase scheduler and protected Vault names
→ publish/update GitHub Release notes
```

Production secret、target confirmation 和 remote-write authorization 只存在于受保护 production environment / canonical wrappers 中。`VERCEL_TOKEN` 必须是 project-scoped `rivalhub-release`，只负责 exact production deploy。Deploy 后 job 通过 `id-token: write` 在运行时向 GitHub OIDC endpoint 申请短期 token，使用 audience `https://github.com/Starfie1d1272`；protected `https://*.vercel.app` smoke 只通过 `x-vercel-trusted-oidc-idp-token` header 访问 exact deployment URL，canonical `https://match.starfie1d.top` 则用普通 HTTPS read-back，不携带 OIDC header。不得使用长期 bypass secret、Full Account/user/team token 或关闭 Deployment Protection 代替。deployment URL 与 canonical production domain 都必须通过 `/api/system/release` 返回仅含 `releaseTag` 和 `releaseCommit` 的 identity，且分别精确等于当前 immutable tag 与该 tag commit；任一读回失败都阻止后续发布。Scheduler provisioning 使用 `RIVALHUB_ALLOW_REMOTE_DB_WRITE=production pnpm db:production:scheduler:provision`，通过 pg_cron named schedule upsert 幂等收敛 `rivalhub-<job-key>` jobs，随后运行 verify。Verify 会确认 pg_cron/pg_net、UTC schedule、dispatch command 与 Vault secret name，实际 dispatch 每个 registry job，并在有界窗口内等待 fresh primary trigger、endpoint success 与分钟级 cron success；任一失败都阻止发布 GitHub Release，且全程不输出 secret。

首次受保护 release 前，Vercel owner 必须在 `Settings → Deployment Protection → Trusted Sources → External Services → Add → GitHub Actions` 建立 Trusted Source，并按当前 GitHub Actions 引导表单配置：

| Dashboard 字段 | 当前值 |
| --- | --- |
| GitHub account | `Starfie1d1272` |
| Repository | `RivalHub` |
| Workflow | `Release` |
| Branch | `Any branch` |
| Audience | `https://github.com/Starfie1d1272` |
| Applies to environments | `Production` |

Issuer 由 GitHub Actions provider 固定为 `https://token.actions.githubusercontent.com`。当前配置使用引导表单即可；raw claims/editor 是可选的 advanced mode，`sub` 或 `environment` claim 不是本配置的 Dashboard 必填字段。本 workflow 同时支持 tag push 与同一 tag 的手动 retry；`Any branch` 允许这些合法 ref，由 workflow 自己校验 tag 必须属于 `main`。代码只能申请 token 并发送 header，不能替代 owner 的 Dashboard 配置；在该配置存在且 exact deployment smoke 真实通过前，protected smoke 保持未验收。

### Recovery capability release gate

PR `#577` 必须先独立进入一个 patch release；这个 release 才把 recovery workflows、GitHub OIDC protected smoke 与 production pre-release backup hard gate 作为 shipped capability。该 release 不得同时包含 destructive migration PR `#585` 的 `drizzle/migrations/0049_ambiguous_brood.sql`。

在 PR `#585` 允许合并或发布之前，必须先完成一次真实的 recovery acceptance：

```text
production encrypted backup
→ private R2 真实 GET + 内容 hash read-back
→ 使用本地离线 age private key 解密
→ disposable isolated target restore / verify / application smoke
```

只有上述 restore rehearsal 成功并保留安全摘要后，才允许继续 #585 的 merge/release gate；如果 restore 未成功，#585 必须保持未合并、未发布。#577 与 #585 不得第一次共同进入同一 release。

## 4. 失败与重试

可安全重试的外部失败使用 workflow dispatch 重跑**同一个已存在 tag**。不要移动 tag、替换 tag source、手工 patch production DB 后绕过 workflow，或用未经验证的本地 build 直接覆盖 production。

需要代码变更时，准备新的 release commit 和新版本。

## 5. Release 完成条件

只有以下条件都成立才算完成：

- production smoke 通过，且 deployment URL 与 canonical production domain 的 `/api/system/release` 均精确读回该 immutable tag 与 tag commit；
- Vercel Trusted Source 已由 owner 按上述 GitHub Actions 引导字段配置（`Starfie1d1272` / `RivalHub` / `Release` / `Any branch` / audience / Vercel `Production`），运行时 OIDC protected exact-deployment smoke 通过；`VERCEL_TOKEN` 仍为 project-scoped `rivalhub-release`；
- production scheduler provision/verify 通过，且 primary named jobs、真实 dispatch、endpoint success 与分钟级 cron execution 已读回；
- GitHub Release 已发布且 notes 正确；
- tag、release commit 与 production deployment 对齐；
- 需要 production acceptance 的 Issue 已获得真实生产证据后再关闭。
