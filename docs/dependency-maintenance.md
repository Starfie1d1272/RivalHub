# 依赖维护

包管理器版本以根 `package.json` 的 `packageManager` 为准。云端、本地和 CI 使用同一个精确版本；CI setup action 从 manifest 读取，不另外填写 pnpm 版本。子包命令使用所属 workspace 的包管理器。

日常安装使用 `pnpm install --frozen-lockfile`（workspace 也默认启用冻结安装）。拉取代码后先安装，再运行检查。依赖声明或配置与锁文件不一致时应失败，不能在运行脚本时静默重装。

有意升级时修改依赖声明，运行 `pnpm install --no-frozen-lockfile`，由 pnpm 生成并提交完整锁文件，再执行相关类型检查、测试和构建。pnpm 12 的锁文件包含包管理器 bootstrap 和项目依赖两个 YAML document；不要手工删段、排序或在命令退出时恢复旧锁文件。升级包管理器引起的一次格式转换应与升级一起提交。

验证安装稳定性：保存锁文件 SHA-256，连续执行冻结安装与日常 `pnpm exec` / `pnpm run`，确认哈希不变。需要新增、移除或升级依赖时重新生成锁文件；冻结安装不承担版本更新。

TypeScript 7 用于原生编译/类型检查。TypeScript 6 的最新稳定 API 包通过 `typescript` alias 供旧编译器 API 消费方使用（架构检查、ESLint，RivalHub 还包括 Next.js 配置/构建检查）；这不是应用运行时依赖。迁移这些工具需要明确验证新的 API 和检查覆盖，不能直接替换导致检查失效。

浏览器验证需要当前 Playwright 版本配套的 Chromium：`pnpm exec playwright install chromium`。系统 Chromium 的存在不能证明 Playwright 默认配置可启动。云环境将 `PLAYWRIGHT_BROWSERS_PATH` 指向可写且可持久保存的目录。

## GitHub graph 与 updater

GitHub 静态解析可能只读取 pnpm 12 bootstrap document。`scripts/dependencies/graph.ts` 是本仓 dependency submission owner：读取所有 canonical YAML document，以 importer roots 遍历 resolved snapshots，保留 peer/optional 实际边；合并同一 npm 版本的上下文时并集依赖，runtime 优先于 development，直接声明优先于传递。npm alias 使用实际 package identity；pnpm 下载的 Node runtime 使用 generic purl，不冒称 npm node 包。未解析引用或不支持的 lock identity 失败关闭，不改写锁文件。

CI 的只读 build job 保存 exact SHA/ref snapshot（十四天 artifact），不调用 dependency submission API，不获得 contents-write 权限，不改变现有 dependency-review 或 Dependabot updater 配置。专用来源变量防止 GitHub 保留 merge identity 覆盖 PR head。只读脚本/产物不能宣称 GitHub graph 已持续覆盖所有后续版本。

`verify-sbom` 检查每个包、每条 dependency edge，以及 SPDX DESCRIBES 所指 repository root 的 direct edges：直接依赖不得缺根边，传递依赖不得误标 direct。其它 GitHub Actions detector 的根依赖不影响应用判断。SPDX export 未提供 runtime/dev scope label，scope 由 exact snapshot 与锁图遍历/单测核验，不假称可回读 label。核对时使用与已提交 snapshot 一致的 exact lockfile；default-branch SBOM 不能用于宣称 PR head 的不同 directness 已上线。

自动 dependency submission 与 updater 配置恢复需要独立权限/执行决定，不属于当前只读子集。API 要求 contents-write，原 CI 没有该权限；现有受 production environment 保护的 release job 不是可复用依赖提交入口。Dependabot 的 pull_request_target 仍可能只有 read-only token，owner PR 通过不能代替真实 Dependabot receipt；禁止为补验收创建 token、扩权限或借用 release 凭据。当前 updater/scheduled run 与 alerts API 的未验收边界继续留在执行 Issue。

协议见 [GitHub dependency submission API](https://docs.github.com/en/rest/dependency-graph/dependency-submission)、[Dependabot Actions 限制](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-on-actions)。一次实际 source/read-back 材料见 [归档](archive/dependency-graph-2026-10-11/README.md)，持续验收留在 Issue。
