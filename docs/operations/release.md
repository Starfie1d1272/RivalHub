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
→ migrate + verify production database
→ deploy exact tag commit to Vercel Production
→ smoke deployment + canonical production domain
→ provision + verify Supabase scheduler and protected Vault names
→ publish/update GitHub Release notes
```

Production secret、target confirmation 和 remote-write authorization 只存在于受保护 production environment / canonical wrappers 中。Scheduler provisioning 使用 `RIVALHUB_ALLOW_REMOTE_DB_WRITE=production pnpm db:production:scheduler:provision`，随后运行 verify；它会幂等替换 `rivalhub-<job-key>` named jobs，确认 pg_cron/pg_net、UTC schedule、dispatch command 与 Vault secret name，但不会输出 secret。

## 4. 失败与重试

可安全重试的外部失败使用 workflow dispatch 重跑**同一个已存在 tag**。不要移动 tag、替换 tag source、手工 patch production DB 后绕过 workflow，或用未经验证的本地 build 直接覆盖 production。

需要代码变更时，准备新的 release commit 和新版本。

## 5. Release 完成条件

只有以下条件都成立才算完成：

- production smoke 通过；
- production scheduler provision/verify 通过，且 primary named jobs 与 endpoint credential contract 已读回；
- GitHub Release 已发布且 notes 正确；
- tag、release commit 与 production deployment 对齐；
- 需要 production acceptance 的 Issue 已获得真实生产证据后再关闭。
