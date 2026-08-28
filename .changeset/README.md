# Changesets

本目录由 [changesets](https://github.com/changesets/changesets) 管理 RivalHub 的版本号与 CHANGELOG。

## 日常：记录一次变更

每完成一个改动（feat / fix / refactor 等），运行：

```bash
pnpm changeset
```

按提示选择 bump 等级（patch / minor / major）并写一句变更描述，会生成一个 `.changeset/*.md` 文件，**随代码一起提交**。

## 发版：消费所有 changeset

```bash
pnpm exec changeset version   # 自动 bump package.json + 写入 CHANGELOG.md
# 人工 review CHANGELOG → 提交 → 打 v 前缀 tag → push --follow-tags
```

## RC prerelease

2.0 RC 首次发布前进入 prerelease mode；后续 RC 继续运行 `changeset version`，由 Changesets 生成一致的 `rc.N` 编号：

```bash
pnpm exec changeset pre enter rc   # 只在首次进入 RC 线时运行
pnpm exec changeset version
```

RC tag（例如 `v2.0.0-rc.0`）会由 release workflow 标记为 GitHub Pre-release，不会成为 latest stable。验收完成后退出 prerelease，再消费 changeset 生成稳定版：

```bash
pnpm exec changeset pre exit
pnpm exec changeset version
```

> RivalHub 是 private 单包，不发布到 npm；tag 手动使用 `vX.Y.Z` 或 `vX.Y.Z-rc.N`，由 `.github/workflows/release.yml` 监听触发 GitHub Release。完整流程见 `.claude/skills/release.md`。
