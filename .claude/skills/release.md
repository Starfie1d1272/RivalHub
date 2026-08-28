---
name: release
description: RivalHub 标准版本发布流程 — changeset 管理版本号与 CHANGELOG、tag 对齐、推送
---

# RivalHub Release（changeset 流程）

执行标准版本发布流程。遇到错误立即停止并说明原因。

> RivalHub 自 v1.30.0 起用 [changesets](https://github.com/changesets/changesets) 管理版本号与 CHANGELOG。
> 项目是 private 单包，**不发布到 npm**；版本 tag 手动使用 `vX.Y.Z` 或 `vX.Y.Z-rc.N`，由 `.github/workflows/release.yml` 监听 `v*` 触发 GitHub Release。含 `-` 的 RC tag 会标记为 GitHub Pre-release。

---

## 日常开发：记录变更（不是发版）

每完成一个改动就运行，**随代码一起提交** `.changeset/*.md`：

```bash
pnpm changeset          # 选 patch/minor/major + 写描述
```

版本号规范见 CLAUDE.md / AGENTS.md。**禁止手动改 `package.json` 的 version**——由 `changeset version` 统一 bump。

---

## 发版流程

### Step 0: 确认有待发布的 changeset

```bash
ls .changeset/*.md | grep -v README   # 应有至少一个未消费的 changeset
node -p "require('./package.json').version"   # 当前版本
```

若没有 changeset 但确需发版（如纯文档/紧急），先补 `pnpm changeset`。

### Step 1: 消费 changeset → bump + CHANGELOG

```bash
pnpm exec changeset version
```

自动：bump `package.json` version、删除已消费的 `.changeset/*.md`、在 `CHANGELOG.md` 写入新版本条目。

2.0 RC 首次发布时先进入 prerelease mode：

```bash
pnpm exec changeset pre enter rc
pnpm exec changeset version
```

后续 RC 只重复 `pnpm exec changeset version`。验收完成后退出 RC 并生成稳定版：

```bash
pnpm exec changeset pre exit
pnpm exec changeset version
```

记录新版本：

```bash
NEW_VER=$(node -p "require('./package.json').version")
PREV_VER=$(git describe --tags --abbrev=0 | sed 's/^v//')
```

### Step 2: Review CHANGELOG + 比较链接

- 人工检查 `CHANGELOG.md` 新条目，按需润色为中文、补充上下文。
- 底部维护比较链接（若缺）：

```
[NEW_VER]: https://github.com/Starfie1d1272/RivalHub/compare/v{PREV_VER}...v{NEW_VER}
```

> **特殊大版本**（如重大重构/移除大功能）可绕过 changeset 自动文案，**手写** `## [NEW_VER] - DATE` 条目（Added/Changed/Removed/Fixed 分类，中文精细描述）。`release.yml` 的 awk 已兼容 `## [ver]` 与 `## ver` 两种标题。

### Step 3: 同步项目文档

```bash
sed -i '' "s/v${PREV_VER}/v${NEW_VER}/g" CLAUDE.md AGENTS.md README.md 2>/dev/null
grep -n "v${NEW_VER}" AGENTS.md README.md
```

### Step 4: 提交（必须在打 tag 之前）

```bash
git add -A
git commit -m "release: v${NEW_VER}"
```

**CHANGELOG 必须在 tag 之前提交**，否则 release workflow checkout tag 时条目为空。

### Step 5: 打 tag（手动 v 前缀）

```bash
git tag "v${NEW_VER}" HEAD
```

> changeset 配置 `privatePackages.tag=false`，**不由 changeset 打 tag**，统一手动打 `vX.Y.Z` 以匹配 `release.yml` 的 `v*` 触发器。

### Step 6: 推送（必须带 tag）

```bash
git push origin <当前分支> --follow-tags
```

**禁止**普通 `git push`（tag 不推则 GitHub Release 不触发）。

### Step 7: 验证

```bash
gh run list --workflow=release.yml --limit=3
```

Release 链接：`https://github.com/Starfie1d1272/RivalHub/releases/tag/v${NEW_VER}`

### Step 8: PR 合入 main（若在功能/发布分支）

```bash
gh pr create --title "v${NEW_VER}: <简述>" --body "<changeset/CHANGELOG 摘要 + Test plan>"
```

---

## 错误速查

| 症状 | 原因 | 修复 |
|---|---|---|
| Release body 为空 | CHANGELOG 在 tag 之后才提交 | `gh release edit vX.Y.Z --notes-file /tmp/notes.md` |
| Release 未触发 | tag 没推到远程 | `git push origin vX.Y.Z` |
| tag 打在错误 commit | tag 后有追加提交 | `git tag -f vX.Y.Z HEAD && git push origin vX.Y.Z --force` |
| `changeset version` 没改版本 | 没有未消费的 changeset | 先 `pnpm changeset` 写一个 |
| CHANGELOG 顶部混入 `# rivalhub` 标题 | changeset 首次写入 | 手工删除多余标题，保留 `# Changelog` |
| compare 链接 404 | 旧 tag 不存在 | 确认 `PREV_VER` tag 已推送 |
