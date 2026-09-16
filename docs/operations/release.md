# 发布操作

RivalHub 使用单主干与不可变 tag。`main` 是唯一可发布主干；`vX.Y.Z` 或 semver 预发布 tag 提供候选版本身份标识，权威生产环境回读才是已发布生产版本的事实来源。本文件是发布流程的唯一负责人；协作与 Changeset 规则见 [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md)，可执行实现见 [`.github/workflows/release.yml`](../../.github/workflows/release.yml)。任何发布、tag、部署或生产环境写操作前必须完整读取本文件。

## 1. 发布 PR

从最新 `main` 创建短期发布分支，消费待发布 Changesets：

```bash
pnpm exec changeset version
```

提交前确认软件包版本、CHANGELOG 分类/对比链接、发布相关的 feat/fix/security/migration 均准确；仍需生产环境或外部验收的事项必须保持未验收表述。发布 PR 按普通 PR 进入 `main`，通过必需的持续集成检查后执行压缩合并。CHANGELOG 的对比链接可比较相邻的不可变 tag，已发布 tag 不移动；正式发布说明由权威上一生产版本身份标识到当前版本身份标识的完整差异生成。

## 2. 发布提交与 tag

合并后从远端 `main` 回读实际压缩合并提交 SHA，并确认该精确提交在 `main` 上的权威持续集成工作流运行记录（event=push、branch=main、head_sha=RELEASE_SHA）已通过。只在这个提交上创建不可变的 `vX.Y.Z` 或显式 semver 预发布 tag；普通 `main` 合并不会自动部署到生产环境。即使提前打 tag，发布工作流自身的预检查也会强制执行这项精确 SHA 前置条件。

## 3. 受保护的发布工作流

推送 tag 或显式重试已有 tag 后，GitHub Actions 的 **Release** 工作流围绕同一个不可变 tag 提交执行：

```text
验证 tag 属于 main
→ 冻结权威上一生产版本身份标识（tag + 提交，精确配对）
→ 验证精确 SHA 前置条件（main 上的权威推送运行记录 = 成功）
→ 验证有效迁移链（仅数据库的本地演练）+ 上一版本兼容性
→ 新建发布前备份 + R2 回读
→ 迁移并验证生产数据库
→ 将候选版本分阶段部署到 Vercel 生产环境（--prod --skip-domain）
→ 对精确候选部署执行冒烟检查（OIDC 令牌）
→ 调用 `scripts/release/routing.ts`（切换 → 别名收敛 → 权威语义收敛；失败时执行回退补偿）
→ 配置并验证生产环境定时任务
→ 发布或更新 GitHub 发布说明
```

关键安全与执行边界：

1. **冻结上一生产版本身份标识**：在任何持续集成等待、备份、迁移、部署或路由写操作之前，`scripts/release/production-identity.ts` 只读取一次权威 `/api/system/release`，冻结 `RIVALHUB_PREVIOUS_RELEASE_TAG` 与 `RIVALHUB_PREVIOUS_RELEASE_COMMIT` 这一不可分割的配对，并写入后续工作流步骤。tag 必须精确指向该 SHA；上一版本提交必须位于候选版本的 `main` 提交链上且包含已发布源代码，候选版本不能与上一版本相同。身份标识缺失、不一致、无法解析或不满足提交链要求时，全部拒绝继续。
2. **精确 SHA 持续集成前置条件**：在任何备份、迁移或部署之前，发布流程必须验证当前不可变 tag 对应的 `RELEASE_SHA` 在 `main` 上的权威推送运行记录结果为 `completed && success`；运行中的记录进行有限次查询，缺失、失败、取消或超时全部拒绝继续。
3. **仅数据库迁移演练**：本地迁移演练仅启动 PostgreSQL 容器（`pnpm db:local:start-db`），不启动本地 Supabase 的认证/存储/浏览器等无关服务；持续集成的临时运行器结束时自动回收容器，不再支付无意义的停止开销。
4. **分阶段部署到生产环境**：使用 `vercel deploy --prod --skip-domain` 在生产环境完成构建，但不把生产域名指向该候选版本；先用短期 GitHub OIDC 令牌对精确候选 URL 完成 `/` 与 `/api/system/release` 冒烟检查。
5. **切换与回退边界**：候选版本冒烟检查通过后，唯一可执行负责人 `scripts/release/routing.ts`（工作流通过 `pnpm release:routing` 调用）只消费发布开始时冻结的上一生产版本身份标识，并在任何路由写操作前冻结上一部署和候选部署的项目、目标环境与就绪状态。它通过 `scripts/release/vercel-routing.ts` 复用 Vercel REST API `POST /v10/projects/{projectId}/promote/{deploymentId}` 与 `POST /v1/projects/{projectId}/rollback/{deploymentId}`，不调用需要用户级查找的 CLI；切换不会触发二次构建。YAML 只负责受保护配置和控制器接线。
6. **阶段耗时证据**：各阶段耗时由 `scripts/ci/timing.mjs` 统一记录并写入步骤摘要，包含备份内部子阶段（数据库导出、存储快照、加密归档、R2 上传与回读）及各部署步骤。

生产环境密钥、目标确认和远程写入授权只存在于受保护的生产环境、权威封装函数中。`VERCEL_TOKEN` 必须是项目级凭据，仅用于精确的生产部署和项目级切换/回退 API 调用；不得为了解决 CLI 的作用域查找而改用完整账户、用户或团队令牌。发布任务使用 `id-token: write`，运行时向 GitHub OIDC 接口申请短期令牌，受众为 `https://github.com/Starfie1d1272`；受保护的精确 `https://<deployment>.vercel.app` 冒烟检查只发送 `x-vercel-trusted-oidc-idp-token`。权威 `https://match.starfie1d.top` 使用普通 HTTPS 回读，不携带 OIDC 请求头。

不得使用长期绕过密钥、完整账户/用户/团队令牌或降低部署保护来代替 Trusted Source。部署 URL 与权威域名的 `/api/system/release` 都必须严格只返回 `releaseTag`、`releaseCommit`，并精确等于当前不可变 tag 与 tag 提交；任一失败都阻止后续发布。发布前备份失败会阻止生产数据库迁移。

### 冻结上一生产版本身份标识

`production-identity.ts` 的权威回读是发布开始时唯一的上一生产版本快照：它发生在精确 tag 检出后、精确 SHA 持续集成等待之前，并在工作流后续步骤中保持不变。`RIVALHUB_PREVIOUS_RELEASE_TAG` 与 `RIVALHUB_PREVIOUS_RELEASE_COMMIT` 必须作为同一组配对值传给迁移兼容性检查、路由切换、生产版本增量发布说明以及其他上一生产版本消费者；任何消费者都不能重新从“最新稳定 tag”、`origin/main` 或服务商当前状态推导基线。

`RIVALHUB_PRODUCTION_STABLE_REF` 与基于 Git 推导最近稳定版本的辅助函数仅供开发环境/持续集成兼容性演练使用。生产发布设置显式身份标识硬门槛，永远不以失败的中间 tag 作为上一生产版本：失败的不可变 tag 只是一次发布尝试的产物，不是已发布的生产版本身份，也不应在发布说明中声称已经上线。发布说明必须覆盖冻结的上一版本到当前版本的完整 CHANGELOG 差异，因此会包含中间条目，但会明确中间版本并未成功发布。

### 发布路由控制器

`scripts/release/routing.ts` 是发布路由切换的唯一可执行负责人；`scripts/release/vercel-routing.ts` 是它使用的 Vercel 服务商适配器，不是额外的工作流入口。两者保留当前生产发布的接口、Vercel 项目级凭据和版本身份标识契约；工作流不再在 YAML/Bash 中复制部署解析、别名等待、语义冒烟检查或回退状态机。

服务商适配器为每个 HTTP 请求设置请求级超时；GET 的网络失败、429 和选定的 5xx 只在有限次数内重试，并与业务状态等待分开。切换/回退 POST 只把 HTTP 201/202 视为 `accepted`（已接受）；429 明确按 `Retry-After`/退避策略执行一次有限重试，超时/5xx 等结果不明确的情况则进入短暂的状态核对观察窗口。完整观察窗口内持续观察上一版本路由；只有窗口结束、至少有两次有效观察，且全程都是精确的上一版本且状态为 `succeeded`（成功），没有 `transient`（暂时性失败）、`unknown`（未知）或 `unrelated`（无关）状态时才允许一次重试；发现目标已被服务商接受时立即记为 `reconciled`（已核对），绝不重复 POST，观察仍不明确则拒绝继续。

切换 `accepted`（已接受）后，控制器分别等待服务商别名操作和权威 `/`、`/api/system/release`。HTTP 200 但版本身份标识仍是合法旧值属于 `not_converged`（尚未收敛），不是立即失败；只有精确的 `releaseTag`/`releaseCommit` 才算成功。服务商别名收敛保持 180 秒截止时间；权威语义收敛使用独立的 120 秒截止时间，查询间隔为 2 秒，结果不明确时默认状态核对观察窗口为 15 秒。格式错误的身份标识、401/403 和不可重试的服务商契约直接快速失败，截止时间到期归类为 `convergence_timeout`（收敛超时）。

切换后的最终失败会以写操作前冻结的上一部署为唯一回退目标。回退 `accepted`（已接受）后仍必须等待别名操作，并等待权威身份标识精确恢复上一 tag/SHA；恢复未确认时发布保持 `failed`（失败），控制器输出 `rollback_failed`（回退失败）与人工介入提示，不继续配置定时任务或发布 GitHub 版本，也不自动反向执行 PostgreSQL 迁移。每次控制器运行都会写入低敏步骤摘要，至少包含候选/上一部署、切换、权威收敛、回退结果和最终分类。

### Vercel Trusted Source（仅所有者配置）

首次受保护发布前，Vercel 所有者必须在 `Settings → Deployment Protection → Trusted Sources → External Services → Add → GitHub Actions` 建立 Trusted Source。引导字段和原始声明使用以下真实值：

| 控制台字段 | 值 |
| --- | --- |
| GitHub 账户 | `Starfie1d1272` |
| 仓库 | `RivalHub` |
| 分支 | 留空（发布使用版本 tag） |
| GitHub Actions 环境 | `production` |
| 受众 | `https://github.com/Starfie1d1272` |
| 适用环境 | `Production` |

签发者固定为 `https://token.actions.githubusercontent.com`。点击 `Edit raw claims`（编辑原始声明），加入以下精确匹配声明（名称和值区分大小写）：

| 原始声明 | 精确值 |
| --- | --- |
| `aud` | `https://github.com/Starfie1d1272` |
| `repository` | `Starfie1d1272/RivalHub` |
| `repository_id` | `1231811932` |
| `workflow` | `Release` |
| `environment` | `production` |
| `sub` | `repo:Starfie1d1272/RivalHub:environment:production` |
| `event_name` | `push`, `workflow_dispatch` |

不填写 `ref` 或 `workflow_ref`：推送 tag 时的 ref 是变量 `refs/tags/v<version>`，手动触发时的 ref 也不是固定值，Trusted Source 的声明匹配采用精确匹配。工作流自行验证 tag 提交属于 `main`；Trusted Source 通过 `repository`、`repository_id`、`workflow`、`environment`、`sub` 和 `event_name` 收窄范围。代码只能申请 OIDC 令牌并发送请求头，不能替代所有者在控制台中的配置；在控制台配置完成且精确部署冒烟检查真实通过前，受保护冒烟检查保持未验收。

## 4. 恢复能力发布门槛

恢复能力加固作为独立发布能力进入 `main` 后，仍须完成一次真实验收，才能关闭对应 Issue 或放行后续高风险迁移：

```text
生产环境加密备份
→ 私有 R2 工件/旁车文件/完成标记 PUT + HEAD + 实际 GET/哈希回读
→ 离线只读获取
→ 本地离线解密 age 私钥
→ 一次性隔离目标恢复/验证/应用冒烟检查
```

处于 active 状态的 `education-evidence` 业务副本继续保留 7 天；加密 DR 副本最多保留 30 天，过期证据不会在恢复过程中重新激活。恢复策略注册表允许 `team-logos` 与 `season-public-assets` 使用 `durable/always`，允许 `education-evidence` 使用 `temporary-sensitive/active-reference-only`；未知 `bucket/type` 必须拒绝继续。`season-public-assets` 是公开的赛事运营图片 bucket，当前用于群二维码；迁移、存储验证与恢复清单必须共同证明其公开、1 MiB、JPEG/PNG/WebP 契约。

## 5. 并发与重试

`release.yml` 与 `recovery-backup.yml` 共享 `rivalhub-production-state-serialization` 组，配置 `queue: max` 与 `cancel-in-progress: false`。这样发布迁移与备份引用窗口不会被互相取消或产生竞态覆盖；`recovery-r2.yml` 是独立的服务商配置校验工作流，不参与数据库串行排队。手动触发可以重试同一个已存在的 tag 或对应操作；不得移动 tag、手工修补生产数据库、用未经验证的本地构建覆盖生产环境，或绕过失败的强制门槛。

## 6. 冷启动配置回读

恢复能力验收还要人工确认 Supabase 方案/物理备份/PITR、认证/API 密钥、Realtime、必要的数据库扩展和设置、存储配置、Vercel Trusted Source、GitHub 环境/OIDC/密钥/变量、R2 30 天生命周期/锁定/私有域名，以及调度器 pg_cron/pg_net/Vault 名称。只记录是否存在、负责人、能力和保留期，不记录密钥值、PII、签名 URL 或导出文件。Supabase 数据库备份不包含存储对象，因此服务商克隆或恢复后必须单独重建这些配置。

这次变更不迁移 PostgreSQL TLS 配置，不把现有 `service_role` 变量做全仓库改名或扩大权限；恢复/备份只使用现代 `SUPABASE_SECRET_KEY`，并为既有配置保留明确的旧配置回退。离线获取复用标准 R2 凭据；该凭据本身可能具备写权限，但获取代码路径只暴露 `HEAD/GET`，不调用 R2 写接口，也不读取数据库、部署信息或 age 私钥凭据。

## 7. 发布完成条件

只有以下条件全部成立才算发布完成：

- tag、实际发布提交、生产部署身份标识对齐；
- 发布开始时已冻结并校验权威上一生产版本身份标识，且 tag/SHA 配对在兼容性检查、路由切换与发布说明中保持一致；
- 发布前备份、R2 HEAD/实际 GET/哈希回读通过；
- 生产迁移与验证、Vercel 受保护冒烟检查、权威身份标识回读、调度任务配置与验证通过；
- GitHub 发布说明使用上一版本到当前版本的生产差异，且不把失败的中间 tag 表述为已上线；CHANGELOG 对比链接正确；
- Vercel Trusted Source 已由所有者配置，并以短期 GitHub OIDC 精确部署冒烟检查证明；
- 需要生产环境验收的 Issue 在具备真实证据后再关闭。

生产环境破坏性恢复、服务商切换、事故冻结和 Issue 关闭不是普通发布重试的隐含副作用；必须满足各自明确的授权与独立证据门槛。
