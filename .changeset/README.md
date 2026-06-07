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
pnpm changeset version   # 自动 bump package.json + 写入 CHANGELOG.md
# 人工 review CHANGELOG → 提交 → 打 v 前缀 tag → push --follow-tags
```

> RivalHub 是 private 单包，不发布到 npm；tag 仍用 `vX.Y.Z` 手动打，由 `.github/workflows/release.yml` 监听触发 GitHub Release。完整流程见 `.claude/skills/release.md`。
