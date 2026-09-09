# RivalHub 协作与交付

技术架构、测试与部署边界分别见 [`docs/architecture.md`](docs/architecture.md)、[`docs/testing.md`](docs/testing.md)、[`docs/deployment.md`](docs/deployment.md)。Issue/PR 不替代 code、tests、active migrations 或 GitHub ruleset 的实际证据。

## Branch, Issue and PR

- `main` 是唯一长期 releasable trunk。常规工作从最新 `main` 创建 `feat/*`、`fix/*`、`docs/*` 等短期分支，PR base 为 `main`；只允许 squash merge，不直接 push/force-push `main`。
- `vX.Y.Z` tag 才是 shipped production identity；普通 `main` merge 不等于 production deploy。
- 2.x Issue 标题使用 `[2.x] <问题或目标>`；开放 Issue 必须且只能有一个 `priority:P0`–`priority:P3`。Issue 最小结构为背景 → 目标 → 验收，只有能限定实现时再增加范围/非目标。
- PR 标题使用 `type(scope): 摘要`，允许 `feat`、`fix`、`refactor`、`perf`、`docs`、`test`、`build`、`ci`、`chore`、`release`、`revert`；`scope` 可选。人工摘要默认中文，代码名/协议名保留英文。
- PR 关联 Issue 使用 `Refs #N`；是否关闭 Issue 由验收条件决定，不用 `Closes` 代替验收。
- `main` PR 必须满足 required `ci-gate`、strict up-to-date 和已解决 review thread；真实规则以 GitHub ruleset 为准。

## Draft → Ready 开发与 CI

- 新功能、修复和文档工作默认以 **Draft PR** 开始。Draft 期间每次 push 由 Evidence Planner 根据 changed surface 选择 affected static、PostgreSQL integration spec 和 semantic browser flow，并以 `draft-gate` 汇总；该结果用于快速反馈，不是最终 merge evidence。
- 本地迭代只执行与当前改动匹配的 host-only 快速检查。不要为了每次修改重复启动 PostgreSQL、Local Supabase 或 browser 重型环境；对应真实环境证据由 Draft CI 按需运行，失败复现时再按 [`docs/operations/local-development.md`](docs/operations/local-development.md) 启动最小层级。
- 实现和本地快速检查完成、准备交付时，才将 PR 标记为 **Ready for review**。`ready_for_review` 事件必须触发一次不受 affected planner 削减的 FULL CI，覆盖完整 static、postgres、system capability；Ready PR 后续每次 push 也必须重新产生该 commit 的 FULL CI。
- 只有最新 commit 的 FULL CI、required `ci-gate` / `pr-title` 及 ruleset 要求的其它 checks 全部成功，且 strict up-to-date 与 review thread 条件满足后，才可以 merge。Ready PR 的新 push 会使旧 commit 的 FULL evidence 失效，不能沿用旧结果。

## Changeset and release

影响 shipped 用户/管理员体验、production runtime/data contract 或版本发布的 feat/fix/refactor/migration/security 变更，在同一 feature PR 提交中文 Changeset。纯文档、纯测试、CI/开发工具和不改变 shipped behavior 的维护可不写，并在 PR 中说明原因。

Changeset/CHANGELOG 只描述 release-relevant 可观察影响，不复制 commit message 或内部实现清单；不要手改 `package.json` version。

完整 release PR、CHANGELOG compare 链接、immutable tag、migration、exact-source deploy、smoke、retry 与 GitHub Release procedure 只由 [`docs/operations/release.md`](docs/operations/release.md) 维护。已公开 stable tag 不移动、不删除。

## Runtime

Node/pnpm contract 只由 `package.json` 的 `packageManager`、`devEngines.runtime`、`engines.node` 与 lockfile 共同声明。workflow、文档或个人脚本不要复制另一份版本常量；安装和 CI 使用仓库 manifest/lockfile 的 canonical runtime。

## Documentation

active docs 只保存当前稳定知识。改 architecture/domain/workflow/policy/shared UI contract 时同 PR 更新对应 canonical doc；优先**重写原段落为终态**，不要在旧说明后持续追加实施历史。实时工作状态留在 Issues/PRs，旧设计和已失效过程材料进入 `docs/archive/`。

纯文档重构不需要 Changeset，除非它本身改变了 shipped 用户行为或发布内容。

## Before merge

按 [`docs/testing.md`](docs/testing.md) 选择变更所需 evidence。至少检查完整 diff、未跟踪文件、敏感信息、临时产物和 active migration 归属；不要用 PR 文案、视觉 demo 或单一 CI 绿灯替代所需层级的真实验证。
