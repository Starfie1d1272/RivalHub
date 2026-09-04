# RivalHub 协作与交付

本文档承接仓库协作流程；技术架构、测试分层和部署边界分别以 [`docs/architecture.md`](docs/architecture.md)、[`docs/testing.md`](docs/testing.md) 与 [`docs/deployment.md`](docs/deployment.md) 为准。Issue 正文不替代代码、测试、active migration 或 GitHub branch ruleset 的实际证据。

## Branch、Issue 与 PR

- `main` 是唯一长期 integration / releasable trunk；常规工作与 hotfix 都从最新 `main` 创建 `feat/*`、`fix/*` 或 `docs/*` 分支，PR base 为 `main`。所有 PR 只允许 squash merge；`main` 不直接 push、不 force-push 或删除。`vX.Y.Z` tag 才是 immutable shipped production identity，普通 `main` merge 不等于 Production deploy。
- 2.x Issue 标题使用 `[2.x] <问题或目标>`；开放 Issue 必须且只能有一个 `priority:P0`–`priority:P3` label。计划性工作使用现有类型 label；milestone/assignee 只有存在真实 release boundary 或明确 owner 时设置。
- Issue 最小结构是背景 → 目标 → 验收；只有能限定实现时才增加范围、非目标或关联。通过 API/agent 创建或修改 Issue 时显式设置 title 和 labels，不能假设 UI form 自动补齐。
- PR 标题、正文、Changeset 摘要和 release note 默认使用中文，必要的代码名、字段名、协议名和库名保留英文。PR 关联 Issue 使用 `Refs #N`，不要用 `Closes` 代替验收判断。
- `main` PR 依赖 strict up-to-date 的自动化 `ci-gate` 与已解决的 review thread；普通 PR 不以第二人 approval 作为仓库质量策略。规则是否实际生效以 GitHub ruleset 为准，而不是只看本文件。

## Changeset、合并与 release

- 影响用户/管理员体验、production runtime/data contract 或版本发布的 feat/fix/refactor/migration/security 变更，在同一个 feature PR 提交中文 `.changeset/*.md`。纯文档、纯测试、CI/开发工具和不改变 shipped runtime/用户行为的 development-only 依赖维护可不写，并在 PR 中说明“无需 changeset”及原因。
- Changeset 面向 release/CHANGELOG 描述用户可观察影响；不要把内部实现细节或 commit message 原样当 release note。不要手改 `package.json` version；版本、CHANGELOG 和 release path 按 Changesets 与 release skill 处理。
- `main` 合入且 Issue 验收条件已经满足后，Issue 才可关闭；如果验收仍包含 production、真实运营、外部配置或其它 merge 后动作，应保持 open 并记录剩余条件。创建 PR 本身不关闭 Issue。
- release branch 从最新 `main` 创建，消费 Changesets 并完成 CHANGELOG editorial review 后通过 PR squash 回 `main`。release tag 只有在对应实际 `main` release commit 已进入历史后创建；production migration、exact-tag deployment 和 smoke 的顺序以 [`docs/deployment.md`](docs/deployment.md) 与 protected workflow 为准。stable tag 创建后不可移动或删除，GitHub Release 发布后其 tag 与 assets 同样保持不可变。

### 本地 Node/pnpm runtime

`packageManager`、`devEngines.runtime` 和 `engines.node` 共同声明仓库的 pnpm 11.25.0 / Node 24.x contract。pnpm 11 会在 `pnpm install` 时解析 `devEngines.runtime`，并将所需 Node runtime 记录为 `pnpm-lock.yaml` 中的 `node@runtime` 条目；首次安装或清空 pnpm runtime cache 时需要联网下载，后续安装复用缓存。不要删除该 lockfile 条目，也不要把 Node/pnpm 版本重新写回 workflow 私有常量；GitHub Actions 的 `pnpm/setup` 会从同一 manifest 接管 runtime、cache 和 frozen install。

## 验证与提交前检查

按变更范围选择 [`docs/testing.md`](docs/testing.md) 中的 evidence。至少检查完整 diff、未跟踪文件、敏感信息、临时产物和 active migration 归属；不要用视觉 demo 或 PR 文案替代运行时证据。
