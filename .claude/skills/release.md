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

### Stable release editorial pass

`changeset version` 生成的 `CHANGELOG.md` 是结构化发布输入，不应默认视为 stable release 可直接发布的最终文案。所有 stable release 都必须在提交 release commit 前，对**本次尚未发布的新版本章节**完成一次 editorial review。

#### 所有 stable release

- 发布说明默认使用中文；真实代码名、字段名、协议名、库名和其他必要技术术语可以保留英文。
- 从用户、管理员或运营者可观察到的结果出发描述变化，不直接把 commit message、内部实现步骤或无必要的工程术语当作 release note。
- 合并语义重复、过度碎片化或同属一个用户可理解主题的 Changeset 条目。
- 剔除不应进入公开发布说明的纯开发环境、测试、CI 与其他内部维护噪音；但安全、兼容性、迁移、权限和行为变化不得因整理而遗漏。
- 只编辑当前尚未发布的新版本章节。已经发布的 stable、prerelease、tag 与其历史 CHANGELOG 不回写。
- 保留准确的版本标题和事实边界，不为了文案完整而声称尚未实现、尚未部署或仅计划中的能力。

#### major / minor stable 或 prerelease → stable

除上述检查外，必须对整个待发布版本执行一次 release convergence：

- 不只描述“最后一个 RC / 上一个 patch 以来”的增量，而要汇总该版本整个开发周期的核心能力和行为变化。
- 根据实际内容整理为用户可理解的章节，例如 `Added`、`Changed`、`Fixed`、`Security`、`Migration`；没有对应内容的章节不要机械保留。
- 合并 RC 阶段重复描述，删除已经被后续实现替代的临时状态、过渡性限制和开发过程噪音。
- 确认最终 stable 章节能够独立回答：这个版本新增了什么、改变了什么、修复了什么，以及升级或部署时需要注意什么。
- GitHub Release 正文应以完成 editorial review 后的 `CHANGELOG.md` 新版本章节为基线，而不是直接使用 Changesets 自动生成的原始 `Major Changes` / `Minor Changes` / `Patch Changes` 列表。

如果 editorial review 发现已有 release-relevant 变更缺少 Changeset，停止发布流程：先补齐对应发布记录并重新执行必要的版本/CHANGELOG 验证，不要只在 GitHub Release 正文中临时补一句绕过仓库历史。

完成 editorial review 后，检查 `CHANGELOG.md` 的新版本章节、比较链接和完整 diff，再提交语义完整的 release commit：

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
