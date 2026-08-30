# Changesets

本目录由 [changesets](https://github.com/changesets/changesets) 管理 RivalHub 的版本号与 CHANGELOG。

## 日常：在功能 PR 中记录发布变更

Changeset 应在实现对应改动的 **feature branch / PR 内创建并随代码一起提交**，而不是等到准备发版时再回忆和补写。

以下变更通常必须写 changeset：

- 用户或管理员可感知的 `feat` / `fix` / `refactor`；
- production runtime 行为、权限、安全边界或数据 contract 的变化；
- schema / migration 等会改变正式部署数据模型的变化；
- production/runtime dependency 的安全或兼容升级。

以下变更通常可以不写 changeset：

- 纯文档；
- 纯测试；
- CI / 本地开发工具；
- 仅 development dependency，且不改变 shipped runtime 或用户/管理员行为的维护性升级。

无需 changeset 时，应在 PR 中明确写出原因。

需要记录时运行：

```bash
pnpm changeset
```

按提示选择 bump 等级（patch / minor / major），生成 `.changeset/*.md` 并随本 PR 提交。

### 摘要语言与写法

Changeset 摘要会直接进入后续 `CHANGELOG.md`，因此它不是内部 commit message。

- **默认使用中文**；真实代码名、字段名、协议名、库名等必要技术术语可以保留英文；
- 描述用户、管理员或运营者能观察到的变化，而不是罗列内部实现步骤；
- 一条 changeset 聚焦一个可理解的发布主题，避免“misc fixes”“refactor internals”这类不可读描述；
- `patch` 用于兼容性修复、小功能和体验调整；`minor` / `major` 仅在真实版本语义需要时选择。

示例：

```md
---
"rivalhub": patch
---

将设置页桌面端的参赛资料导航移至左侧，并保留移动端顶部导航体验。
```

## 发版：只消费，不补写

发版阶段的职责是消费已经随各功能 PR 进入 `dev` 的 changeset，并 review 最终 CHANGELOG：

```bash
pnpm exec changeset version   # 自动 bump package.json + 写入 CHANGELOG.md
# 人工 review CHANGELOG → 提交 → 打 v 前缀 tag → push --follow-tags
```

如果 release 前才发现某个已合入的 release-relevant change 缺少 changeset，应先补一个明确的 follow-up changeset，再执行 `changeset version`；不要直接手写版本号或把 release commit 当成日常变更记录入口。

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
