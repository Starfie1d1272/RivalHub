# Release operations

RivalHub 使用 single-trunk + immutable tag 的发布模型。`main` 是 releasable trunk；只有 `vX.Y.Z` tag 表示 shipped production identity。

协作规则和 Changeset 约定见 [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md)。

## 1. 准备 release PR

从最新 `main` 创建 release branch，消费待发布 Changesets，并审查：

- package version；
- CHANGELOG 文案；
- 是否遗漏需要对用户说明的 feat/fix/security/migration；
- 是否存在仍需 production / external config 验收的 Issue。

Release PR 仍按普通 PR 进入 `main`，通过 required CI 后 squash merge。

## 2. 确认 release commit

Release PR 合入后，确认准备发布的 commit 已经位于 `main`，且该 commit 的完整 convergence CI 通过。

普通 `main` merge **不会**自动 production deploy。

## 3. 创建 immutable tag

在准确的 release commit 上创建：

```text
vX.Y.Z
```

stable tag 创建后不移动、不删除。prerelease 使用显式 semver prerelease suffix。

## 4. Protected release workflow

Tag push 触发 GitHub Actions **Release** workflow。它围绕同一个 immutable tag commit 完成：

```text
validate tag belongs to main
→ validate active migration chain locally
→ validate previous-release compatibility
→ migrate + verify production database
→ deploy exact tag commit to Vercel Production
→ smoke deployment + canonical production domain
→ publish/update GitHub Release notes
```

Production secret、target confirmation 和 remote-write authorization 只存在于受保护 release environment / canonical wrappers 中。

## 5. 失败与重试

Release workflow 支持对**已经存在的同一个 tag**做安全 retry。失败后不要：

- 移动 tag 到另一个 commit；
- 在 production 手工补 migration 后假装 workflow 已完成；
- 改用未经验证的本地 build 直接部署；
- 从最新 `main` 替换失败 tag 的源代码。

先修复可以安全重试的外部条件，或者在需要代码变更时准备新的 release commit / 新版本。

## 6. Release 后

确认：

- production smoke 通过；
- GitHub Release 已发布且 notes 正确；
- tag、release commit 和 production deployment 对齐；
- 需要 production acceptance 才能完成的 Issue 已获得真实验收证据后再关闭。

Release note、CHANGELOG 和 GitHub Release 描述“这次发布给用户带来了什么”，不要复制内部实现清单。
