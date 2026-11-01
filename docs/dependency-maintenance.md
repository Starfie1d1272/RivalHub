# 依赖维护

包管理器版本以根 `package.json` 的 `packageManager` 为准。云端、本地和 CI 使用同一个精确版本；CI setup action 从 manifest 读取，不另外填写 pnpm 版本。子包命令使用所属 workspace 的包管理器。

日常安装使用 `pnpm install --frozen-lockfile`；CI 的 `pnpm/setup` 通过 `require-lockfile: true` 显式执行冻结安装。拉取代码后先安装，再运行检查。依赖声明或配置与锁文件不一致时安装应失败，`verifyDepsBeforeRun: error` 继续阻止在未同步依赖时执行脚本，不能在运行脚本时静默重装。

有意升级时修改依赖声明，运行 `pnpm install --no-frozen-lockfile`，由 pnpm 生成并提交完整锁文件，再执行相关类型检查、测试和构建。pnpm 12 的锁文件包含包管理器 bootstrap 和项目依赖两个 YAML document；不要手工删段、排序或在命令退出时恢复旧锁文件。升级包管理器引起的一次格式转换应与升级一起提交。

不要在 workspace 全局配置 `frozenLockfile: true`：该设置同样约束 Dependabot 的 `pnpm update --lockfile-only` / `pnpm install --lockfile-only`，使有意更新依赖时无法同步新锁文件。冻结约束属于安装入口；人工或 updater 的更新命令允许生成新锁文件，生成结果仍须经过冻结安装和正常 PR evidence 验证。

验证安装稳定性：保存锁文件 SHA-256，连续执行冻结安装与日常 `pnpm exec` / `pnpm run`，确认哈希不变。需要新增、移除或升级依赖时重新生成锁文件；冻结安装不承担版本更新。

TypeScript 7 用于原生编译/类型检查。TypeScript 6 的最新稳定 API 包通过 `typescript` alias 供旧编译器 API 消费方使用（架构检查、ESLint，RivalHub 还包括 Next.js 配置/构建检查）；这不是应用运行时依赖。迁移这些工具需要明确验证新的 API 和检查覆盖，不能直接替换导致检查失效。

浏览器验证需要当前 Playwright 版本配套的 Chromium：`pnpm exec playwright install chromium`。系统 Chromium 的存在不能证明 Playwright 默认配置可启动。云环境将 `PLAYWRIGHT_BROWSERS_PATH` 指向可写且可持久保存的目录。

## GitHub graph 与 updater

GitHub 静态解析可能只读取 pnpm 12 bootstrap document。`scripts/dependencies/graph.ts` 是本仓 dependency submission owner：读取所有 canonical YAML document，以 importer roots 遍历 resolved snapshots，保留 peer/optional 实际边；合并同一 npm 版本的上下文时并集依赖，runtime 优先于 development，直接声明优先于传递。npm alias 使用实际 package identity；pnpm 下载的 Node runtime 使用 generic purl，不冒称 npm node 包。未解析引用或不支持的 lock identity 失败关闭，不改写锁文件。

PR CI 的只读 build job 保存 exact SHA/ref snapshot（十四天 artifact），不调用 dependency submission API，不获得 contents-write 权限。专用来源变量防止 GitHub 保留 merge identity 覆盖 PR head。PR artifact 本身不能宣称 GitHub graph 已覆盖该 PR。

`.github/workflows/dependency-graph.yml` 独立维护 main 的远端依赖元数据：锁文件、manifest、构图工具或该 workflow 的 main push，以及 weekly / 手动 main 运行，先以 contents-read 生成 exact SHA/ref snapshot，再由独立 submit job 提交。只有 submit job 声明 contents-write；它仅 checkout 对应 main source、下载本次 run 的 snapshot、执行无第三方依赖的 `scripts/dependencies/submit.mjs`，不安装或运行应用依赖。提交器在 POST 前检查 snapshot 的来源、manifest/detector/correlator 和当前 main SHA；main 已前进则失败，需从最新 main 手动重跑 workflow（rerun 旧 run 不会更新 SHA）。不得挪用 release 凭据或新增长期 token。

提交器要求 receipt 为 SUCCESS；ACCEPTED 按 API 定义仅保存 snapshot、没有更新仓库依赖图，必须失败。即使 SUCCESS 也不能代替内容核验：独立 contents-read job 用同一 SHA 的 canonical lockfile 回读 SBOM，逐项检查全部 identities、包间 edges 与 direct roots；允许有限的索引延迟重试，仍不一致则失败。snapshot、submission receipt 和 SBOM/readback 分开保留十四天，summary 记录 source SHA 和锁文件哈希。该 workflow 的启用涉及新增 job 级 contents-write，必须作为独立权限变更审阅；本地验证不代表它已在远端执行成功。

`verify-sbom` 检查每个包、每条 dependency edge，以及 SPDX DESCRIBES 所指 repository root 的 direct edges：直接依赖不得缺根边，传递依赖不得误标 direct。其它 GitHub Actions detector 的根依赖不影响应用判断。SPDX export 未提供 runtime/dev scope label，scope 由 exact snapshot 与锁图遍历/单测核验，不假称可回读 label。核对时使用与已提交 snapshot 一致的 exact lockfile；default-branch SBOM 不能用于宣称 PR head 的不同 directness 已上线。

Dependabot npm version updates 使用 weekly schedule、最多五个 PR 和原 production/development 分组；配置恢复只允许 updater 尝试运行，不证明 pnpm 12 的实际锁文件更新已成功。必须记录真实 npm updater 与后续 scheduled run；github-actions updater 或本地安装不能替代。

main submission 不处理 PR/fork/Dependabot 的写入，也不证明 dependency-review 已识别 PR 新增依赖。Dependabot 的 pull_request_target 仍可能只有 read-only token，owner PR green 不能代替真实 bot evidence；不得因本 workflow 成功而放宽 required dependency-review。PR review 覆盖、alerts/security updates、有权限的安全入口核验和真实 updater/scheduled run 继续在执行 Issue 分别验收。

协议见 [GitHub dependency submission API](https://docs.github.com/en/rest/dependency-graph/dependency-submission)、[Dependabot Actions 限制](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions)。一次实际 source/read-back 材料见 [归档](archive/dependency-graph-2026-10-11/README.md)，持续验收留在 Issue。

## 开发依赖的安全升级

Miniflare 的 `undici` 与 `sharp` 使用限定到该父包版本的安全升级 override；父包采用修复版本后移除对应 override。ESLint、config-array 和 typescript-estree 的 minimatch 使用新版命名导出及 `Minimatch.match` API，通过定向版本选择使用 11.x，父包版本范围支持后移除该选择。

Next.js 官方 lint preset 的 React/import/a11y 插件当前仍使用 minimatch 3.x 的 callable CommonJS API；3.x 不包含 GHSA-g3hv-75wg-m249 所述的高阶预处理路径。该公告按版本范围生成的告警需按实际锁定版本和消费路径核对。保留安全扫描，不设置全局 audit 忽略；父包升级或依赖路径改变时重新核对。
