---
name: release
description: RivalHub 标准版本发布流程：Changesets、main history、tag 与 GitHub Release 对齐
---

# RivalHub Release

Changesets 管理版本号与 `CHANGELOG.md`。RivalHub 是 private 单包，不发布到 npm；`v*` tag 触发 `.github/workflows/release.yml` 创建 GitHub Release。RC 使用 prerelease tag，且不标记为 latest。

遇到错误立即停止并保留已观察到的状态。公开 tag 的异常必须人工确认处理方案，不能把 force-retag 当作常规修复。

## 1. Prepare the release commit

确认待消费的 changeset，然后生成版本与 CHANGELOG：

```bash
ls .changeset/*.md | grep -v README
pnpm exec changeset version
NEW_VER=$(node -p "require('./package.json').version")
```

首次 RC 先进入 prerelease mode；稳定发布前退出：

```bash
pnpm exec changeset pre enter rc
pnpm exec changeset version

# stable release only
pnpm exec changeset pre exit
pnpm exec changeset version
```

检查 `CHANGELOG.md` 的新条目、比较链接和完整 diff，然后提交语义完整的 release commit：

```bash
git add -A
git commit -m "release: v${NEW_VER}"
```

不要手改 `package.json` version。纯文档变更没有发布需求时不创建无意义 changeset。

## 2. Merge through the release path

将 release commit 通过受保护的 release path 合入 `main`，再获取远端状态：

```bash
git fetch origin main --tags
git merge-base --is-ancestor <release-commit-sha> origin/main
```

只有该命令成功，或目标就是预期的 `origin/main` release commit，才可继续创建 tag。不要让 tag 指向尚未进入 main history 的 feature 或 release branch。

## 3. Create and publish the tag

在已验证的 main release commit 上创建并推送 tag：

```bash
git tag "v${NEW_VER}" <release-commit-sha>
git push origin "v${NEW_VER}"
```

然后检查 release workflow 与 GitHub Release：

```bash
gh run list --workflow=release.yml --limit=3
```

RC 应显示为 prerelease 且不是 latest；stable release 使用正常 release 状态。

## Published-tag incident

如果已经公开的 tag 指向错误 commit、缺少 changelog 或 workflow 失败，停止后人工确认处理方案。记录实际 tag、target commit、release 状态与需要的协调，不默认改写 published history。
