---
name: release
description: RivalHub 标准版本发布流程 — CHANGELOG 自动维护、npm version、tag 对齐、推送
---

# RivalHub Release

执行标准版本发布流程。遇到错误立即停止并说明原因。

## Step 0: 确认 bump 等级

如果用户没有指明，询问：`patch / minor / major？`（规则见 CLAUDE.md 版本号规范）

读取当前版本：
```bash
node -p "require('./package.json').version"
```

计算目标新版本（用于后续 CHANGELOG 检查）：
- patch: 最后一位 +1
- minor: 中间位 +1，末位归 0
- major: 首位 +1，后两位归 0

---

## Step 1: 检查 CHANGELOG

```bash
# 获取上一个 tag（即当前版本的 tag）
PREV_TAG=$(git describe --tags --abbrev=0)
NEW_VER=<目标新版本>
TODAY=$(date +%Y-%m-%d)
```

检查 `CHANGELOG.md` 顶部是否有 `## [NEW_VER]` 条目。

**如果已有**：跳到 Step 2。

**如果没有**：自动生成。

```bash
# 取上个 tag 到 HEAD 的提交列表
git log ${PREV_TAG}..HEAD --oneline --no-decorate
```

在 CHANGELOG.md 第一个 `## [` 之前插入：

```markdown
## [NEW_VER] - TODAY

### Added
- （根据 git log 整理，按 feat/fix/docs/refactor 分类）

### Fixed
- （...）
```

> 整理规则：feat: → Added，fix: → Fixed，docs:/chore: 可省略或归入 Changed。
> 用中文描述，保持与现有条目风格一致。

将生成内容展示给用户确认，用户可以修改后再继续。

---

## Step 2: 维护比较链接

检查 `CHANGELOG.md` 底部是否有 `[NEW_VER]: https://github.com/Starfie1d1272/RivalHub/compare/...` 行。

**如果没有**：在最后一个 `[X.Y.Z]:` 行之前插入：

```
[NEW_VER]: https://github.com/Starfie1d1272/RivalHub/compare/v{PREV_VER}...v{NEW_VER}
```

---

## Step 3: 提交 CHANGELOG

如果 CHANGELOG 有修改（Step 1 或 Step 2 改动了文件）：

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG ${NEW_VER}"
```

**必须在 `npm version` 之前提交**，否则 release workflow checkout tag 时 CHANGELOG 条目为空。

---

## Step 4: 同步项目文档

自动更新以下文件中的版本引用（`vX.Y.Z` → `v${NEW_VER}`）：

- `CLAUDE.md`：`当前阶段：**vX.Y.Z**`（在 `项目概述` 段落中）
- `AGENTS.md`：`当前阶段：**vX.Y.Z**`
- `README.md`：版本徽章或描述

**额外校验**：运行 `zsh scripts/check-claude-md.sh` 确保 CLAUDE.md 组件清单与实际文件一致。

```bash
zsh scripts/check-claude-md.sh
```

如有不一致，立即修复 CLAUDE.md 中的组件列表。

```bash
# 查找需要更新的行
grep -n "v${PREV_VER}" CLAUDE.md AGENTS.md README.md
```

用 `sed` 批量替换：

```bash
sed -i '' "s/v${PREV_VER}/v${NEW_VER}/g" CLAUDE.md AGENTS.md README.md
```

确认替换结果：

```bash
grep -n "v${NEW_VER}" CLAUDE.md AGENTS.md README.md
```

提交：

```bash
git add CLAUDE.md AGENTS.md README.md
git commit -m "docs: 同步文档至 v${NEW_VER} — CLAUDE.md/AGENTS.md/README.md"
```

---

## Step 5: npm version（唯一合法方式）

```bash
npm version <patch|minor|major>
# 自动更新 package.json 并创建 vX.Y.Z tag
```

**禁止**：`npm version --no-git-tag-version` + 手动 git tag。

---

## Step 6: 确保 tag 在 HEAD

```bash
TAG_COMMIT=$(git rev-list -n1 v${NEW_VER})
HEAD_COMMIT=$(git rev-parse HEAD)
```

如果两者不同（Step 5 之后有额外 commit），**自动**移动 tag：

```bash
git tag -f v${NEW_VER} HEAD
```

无需询问用户，直接执行。

---

## Step 7: 推送（必须带 tag）

```bash
git push origin dev --follow-tags
```

**禁止**：普通 `git push origin dev`（tag 不会推送，GitHub Release 不触发）。

---

## Step 8: 验证

```bash
gh run list --workflow=release.yml --limit=3
```

显示最新一次 workflow 的状态（queued / in_progress / completed）。

同时给出 GitHub Release 链接：
`https://github.com/Starfie1d1272/RivalHub/releases/tag/v${NEW_VER}`

---

## Step 9: 创建 PR（dev → main）

```bash
git log main..dev --oneline --no-decorate | head -20
```

```bash
gh pr create \
  --title "v${NEW_VER}: <简短描述>" \
  --body "$(cat <<'EOF'
## Summary
- （根据 git log 整理关键变更，按 feat/fix/refactor 分组）

## Test plan
- [ ] pnpm test
- [ ] pnpm tsc --noEmit
- [ ] dev 环境手动验证关键路径
EOF
)"
```

如果 PR 已存在则跳过。输出 PR 链接。

---

## 错误速查

| 症状 | 原因 | 修复 |
|---|---|---|
| Release body 为空 | CHANGELOG 在 `npm version` 之后才提交 | 用 `gh release edit vX.Y.Z --notes-file /tmp/notes.md` 手动更新 |
| Release 未触发 | tag 没推到远程 | `git push origin v${NEW_VER}` |
| tag 打在错误 commit | `npm version` 后有追加提交 | `git tag -f vX.Y.Z HEAD && git push origin vX.Y.Z --force` |
| `npm version` 报 dirty | 工作区有未提交文件 | `git status` 查看，commit 或 stash 后再运行 |
| compare 链接 404 | 旧 tag 不存在 | 确认 `PREV_TAG` 是否已推送到远程 |
