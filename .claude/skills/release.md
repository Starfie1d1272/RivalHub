---
name: release
description: RivalHub 标准版本发布流程：Changesets、release PR、main、immutable tag 与受保护的 production workflow 对齐
---

# RivalHub Release

这是发布操作的薄层 guardrail。详细操作语义以 [`docs/operations/release.md`](../../docs/operations/release.md)、[`CONTRIBUTING.md`](../../CONTRIBUTING.md) 和 `.github/workflows/release.yml` 为准。

RivalHub 使用 single-trunk + immutable-tag 模型：`main` 是唯一长期 releasable trunk，只有精确指向已验证 `main` release commit 的 `vX.Y.Z` tag 才代表 shipped production identity。普通 `main` merge 不等于 production deploy。

遇到错误立即停止并保留已观察到的状态。不要直接 push `main`、手工补 production migration、使用未经 workflow 验证的 build 部署，或移动/删除/force-retag 已公开 tag。

## 1. Decide whether a release is needed

- 影响 shipped 用户/管理员体验、production runtime/data contract 或版本发布的变更，消费对应的中文 Changeset。
- 纯文档、纯测试、CI/开发工具或不改变 shipped behavior 的维护通常不发版本；是否需要 docs-only PR 与用户目标保持一致。
- 从最新 `origin/main` 开始。当前工作区有无关 dirty changes 时，使用独立 branch/worktree 隔离，不 stash、reset、restore 或覆盖用户改动。
- 发布前读取 `CHANGELOG.md`、`package.json`、`AGENTS.md`、`CONTRIBUTING.md`、`docs/operations/release.md` 和 `.github/workflows/release.yml`；不要依赖已删除的本机规则文件或历史计划。

## 2. Prepare the release PR

从最新 `main` 创建短期 release branch，目标必须是 `main`。不要直接在 `main` 上提交 release commit。

先检查待消费的 Changesets：

```bash
git fetch origin main --tags
ls .changeset/*.md | grep -v README
```

按发布类型选择 Changesets 命令：

| 发布类型 | 命令 |
|---|---|
| stable patch/minor/major | `pnpm exec changeset version` |
| 首次进入 RC | `pnpm exec changeset pre enter rc`，然后 `pnpm exec changeset version` |
| 后续 RC | `pnpm exec changeset version` |
| RC → stable | `pnpm exec changeset pre exit`，然后 `pnpm exec changeset version` |

不要手改 `package.json` version。完成 version 后审校：

- 新版本章节只描述用户、管理员或运营者可观察的影响；合并重复条目，删除纯内部噪音；
- stable 版本覆盖整个版本开发周期，不重复罗列已被后续实现替代的中间态；
- trailing reference block 顶部放新 compare link，并比较立即前一个 immutable tag 到新 tag；
- 发现 release-relevant 变更缺少 Changeset 时停止，不用 GitHub Release 正文临时补写绕过历史。

只暂存预期的 release 文件，不能使用 `git add -A`：

```bash
NEW_VER=$(node -p "require('./package.json').version")
git diff --check
git diff -- CHANGELOG.md package.json .changeset
git add CHANGELOG.md package.json .changeset
git diff --cached --check
git commit -m "release: v${NEW_VER}"
```

如果 version 产生其它文件，先检查 diff，再显式加入；不要把旁边未授权的工作混入 release commit。

按 [`docs/testing.md`](../../docs/testing.md) 选择本地 evidence。release candidate 默认至少执行 type-check、lint、unit test 和 build；migration/schema 风险再补 `pnpm db:check`。完整 required CI 和 production compatibility 验证以远端 workflow 为准。

## 3. Create and gate the release PR

推送 release branch，创建 Ready PR 到 `main`，并在 PR 中说明 Changeset、CHANGELOG 和验证范围。PR 必须满足：

- required `ci-gate` 已对当前 head completed success；queued/running 不算通过；
- strict up-to-date，且 review threads 已解决；
- 需要时 Vercel preview / external configuration evidence 已完成；
- PR 只包含本次 release 的预期提交。

Merge 是独立授权点。CI 通过只完成 PR/CI gate，不自动授权 merge；未获明确授权时停在这里。

## 4. Merge, read back, and create the immutable tag

获得 merge 授权并完成 release PR squash merge 后，读取 PR 的实际 squash merge commit。不要把 merge 后可能继续前进的 `origin/main` 快照当作 release SHA：

```bash
git fetch origin main --tags
RELEASE_SHA=$(gh pr view <PR_NUMBER> --json mergeCommit --jq '.mergeCommit.oid')
test -n "$RELEASE_SHA"
git merge-base --is-ancestor "$RELEASE_SHA" origin/main
git show "${RELEASE_SHA}:package.json" | node -e 'let s=""; process.stdin.on("data", c => s += c).on("end", () => console.log(JSON.parse(s).version))'
git show "${RELEASE_SHA}:CHANGELOG.md" | sed -n '1,80p'
git tag "v${NEW_VER}" "$RELEASE_SHA"
git push origin "v${NEW_VER}"
```

tag 必须精确指向已验证的 release merge commit。stable tag 创建后不移动、不删除；prerelease 使用显式 semver prerelease suffix。

## 5. Wait for the protected release workflow

Tag push 触发 `.github/workflows/release.yml`。它围绕同一个 immutable tag commit 完成：

```text
validate tag belongs to main
→ validate active migration chain locally
→ validate previous-release compatibility
→ migrate + verify production database
→ deploy exact tag commit to Vercel Production
→ smoke deployment + canonical production domain
→ publish/update GitHub Release notes
```

必须等待对应 run completed success，并读回 tag、release commit、production deployment、smoke 和 GitHub Release。失败后先修复可安全重试的外部条件；只能对同一个已存在的 tag retry：

```bash
gh workflow run release.yml -f tag="v${NEW_VER}"
```

不要换 commit、移动 tag、在 production 手工补 migration，或直接部署本地 build。

## 6. Release closeout

报告版本号、PR、release SHA、tag、验证命令、workflow、production deployment、smoke 和 GitHub Release 状态。Issue 是否关闭由真实验收决定，不由 PR merge 或 release workflow 自动推断。

正式 release 的分支/worktree 清理只能在以下条件全部满足后执行：工作区 clean、没有 open PR、没有 dirty 或唯一未集成 lane，且已完成远端 read-back。先审计 `git worktree list --porcelain`、分支 tracking/ahead/behind/unmerged commits；保留 `main` 和所有 stable tags，再清理其它明确安全的分支/worktree。任一条件不满足就停在安全边界并报告。

## Common pitfalls

- 只依赖当前 active docs、`CONTRIBUTING.md`、workflow 和仓库现有验证命令；不要恢复旧的本机规则或历史计划。
- 不把 `origin/main` 当前值替代 PR 的实际 squash merge SHA。
- 不把 `git add -A`、直接 push `main`、CI queued/running、PR merge 或 Issue close 当成发布完成。
- 不将纯文档维护强行包装成版本发布，也不为纯文档改动创建无意义 Changeset。
