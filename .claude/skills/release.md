---
name: release
description: RivalHub 标准版本发布流程：Changesets、main history、tag 与 GitHub Release 对齐
---

# RivalHub Release

Changesets 管理版本号与 `CHANGELOG.md`。RivalHub 是 private 单包，不发布到 npm；`v*` tag 触发 `.github/workflows/release.yml` 创建 GitHub Release。RC 使用 prerelease tag，且不标记为 latest。

遇到错误立即停止并保留已观察到的状态。公开 tag 的异常必须人工确认处理方案，不能把 force-retag 当作常规修复。

## 1. Prepare the release commit

确认待消费的 changeset，并选择与发布类型相符的版本步骤：

```bash
ls .changeset/*.md | grep -v README
```

| 发布类型 | 命令 |
|---|---|
| 普通 stable patch/minor/major | `pnpm exec changeset version` |
| 首次进入 RC | `pnpm exec changeset pre enter rc`，然后 `pnpm exec changeset version` |
| 后续 RC | `pnpm exec changeset version` |
| RC → stable | `pnpm exec changeset pre exit`，然后 `pnpm exec changeset version` |

完成后记录版本：

```bash
NEW_VER=$(node -p "require('./package.json').version")
```

检查 `CHANGELOG.md` 的新条目、比较链接和完整 diff，然后提交语义完整的 release commit：

```bash
git add -A
git commit -m "release: v${NEW_VER}"
```

不要手改 `package.json` version。纯文档变更没有发布需求时不创建无意义 changeset。

## 2. Merge through the release path

将 release commit 通过受保护的 release path 合入 `main`，再获取远端状态。tag 指向实际部署的 `main` source commit：

```bash
git fetch origin main --tags
git merge-base --is-ancestor <release-commit-sha> origin/main
RELEASE_SHA=$(git rev-parse origin/main)
git show "${RELEASE_SHA}:package.json" | node -e 'let s=""; process.stdin.on("data", c => s += c).on("end", () => console.log(JSON.parse(s).version))'
git show "${RELEASE_SHA}:CHANGELOG.md" | sed -n '1,80p'
```

确认 `RELEASE_SHA` 包含 release commit、`package.json` 为 `${NEW_VER}`、`CHANGELOG.md` 含对应条目且 required CI 已通过，才可继续。

## 3. Create and publish the tag

在已验证的 main release source commit 上创建并推送 tag：

```bash
git tag "v${NEW_VER}" "${RELEASE_SHA}"
git push origin "v${NEW_VER}"
```

然后检查 release workflow 与 GitHub Release：

```bash
gh run list --workflow=release.yml --limit=3
```

RC 应显示为 prerelease 且不是 latest；stable release 使用正常 release 状态。

## Published-tag incident

如果已经公开的 tag 指向错误 commit、缺少 changelog 或 workflow 失败，停止后人工确认处理方案。记录实际 tag、target commit、release 状态与需要的协调，不默认改写 published history。
