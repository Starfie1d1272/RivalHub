# 依赖维护

包管理器版本以根 `package.json` 的 `packageManager` 为准。云端、本地和 CI 使用同一个精确版本；CI setup action 从 manifest 读取，不另外填写 pnpm 版本。子包命令使用所属 workspace 的包管理器。

日常安装使用 `pnpm install --frozen-lockfile`（workspace 也默认启用冻结安装）。拉取代码后先安装，再运行检查。依赖声明或配置与锁文件不一致时应失败，不能在运行脚本时静默重装。

有意升级时修改依赖声明，运行 `pnpm install --no-frozen-lockfile`，由 pnpm 生成并提交完整锁文件，再执行相关类型检查、测试和构建。pnpm 12 的锁文件包含包管理器 bootstrap 和项目依赖两个 YAML document；不要手工删段、排序或在命令退出时恢复旧锁文件。升级包管理器引起的一次格式转换应与升级一起提交。

验证安装稳定性：保存锁文件 SHA-256，连续执行冻结安装与日常 `pnpm exec` / `pnpm run`，确认哈希不变。需要新增、移除或升级依赖时重新生成锁文件；冻结安装不承担版本更新。

TypeScript 7 用于原生编译/类型检查。TypeScript 6 的最新稳定 API 包通过 `typescript` alias 供旧编译器 API 消费方使用（架构检查、ESLint，RivalHub 还包括 Next.js 配置/构建检查）；这不是应用运行时依赖。迁移这些工具需要明确验证新的 API 和检查覆盖，不能直接替换导致检查失效。

浏览器验证需要当前 Playwright 版本配套的 Chromium：`pnpm exec playwright install chromium`。系统 Chromium 的存在不能证明 Playwright 默认配置可启动。云环境将 `PLAYWRIGHT_BROWSERS_PATH` 指向可写且可持久保存的目录。

## GitHub graph 与 updater

GitHub 静态解析可能只读取 pnpm 12 bootstrap document。`scripts/dependencies/graph.ts` 是本仓 dependency submission owner：读取所有 canonical YAML document，以 importer roots 遍历 resolved snapshots，保留 peer/optional 实际边；合并同一 npm 版本的上下文时并集依赖，runtime 优先于 development，直接声明优先于传递。npm alias 使用实际 package identity；pnpm 下载的 Node runtime 使用 generic purl，不冒称 npm node 包。未解析引用或不支持的 lock identity 失败关闭，不改写锁文件。

CI 的只读 build job 保存 exact SHA/ref snapshot；独立 contents-write job 仅下载/校验 artifact 并提交 GitHub metadata，不执行仓库代码、npm lifecycle 或 PR script。correlator 对 main 保持稳定，其它 ref 分开，避免 PR 覆盖默认分支检测 wave。非默认 ref 的 API ACCEPTED 与 main 的 SUCCESS 都按 exact ref 验证，不能将 ACCEPTED 当默认分支更新成功。dependency-review 等待提交完成；default branch 额外回读 SBOM 验证每个包和每条边，缺证据 required gate 失败。snapshot/submission/readback artifact 保留十四天。fork/Dependabot 的 PR token 不获得写权限；窄范围 pull_request_target workflow 只 checkout 受保护 base，从 PR head 拉取 lockfile 数据交 canonical parser，不执行 PR checkout/lifecycle/script，再调用同一个无 checkout 的 submit owner。PR 只读 review 必须读取 GitHub artifact/run 元数据证明 receipt 来自该 trusted event/path 且 SHA/ref 一致，拒绝伪造名称、旧 head 与失败结果后才开始 vulnerability review；四分钟缺证据失败，可核对 trusted workflow 后重跑。不降级安全 gate。

Dependabot npm updater 保留 weekly schedule 与 production/dev minor-patch groups，最多五个开放 PR；不自动合并。配置恢复、snapshot 201、代表包可见都不能代替实际 updater 锁文件更新成功、下一次 scheduled run 或授权 alerts/security-update 核验。alerts API 403 时保留具体未验收项，不扩大 token 权限。

协议见 [GitHub dependency submission API](https://docs.github.com/en/rest/dependency-graph/dependency-submission)、[submission 使用说明](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/use-dependency-submission-api)。一次实际 source/read-back 材料见 [归档](archive/dependency-graph-2026-10-11/README.md)，持续验收留在 Issue，不把高频运行事实写入本页。
