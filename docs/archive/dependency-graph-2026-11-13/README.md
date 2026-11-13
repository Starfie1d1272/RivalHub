# pnpm 原生依赖图退出核验

2026-11-13，Refs [#493](https://github.com/Starfie1d1272/RivalHub/issues/493)。
基线 `main@1dc0f0cfb04cd81ce74c3451ac3dbb7aef240f28`。

## 结论

原生解析已识别项目依赖，但本仓兼容层尚不能退出。隔离的新 manifest 原生读取缺少环境工具链与 Node runtime，且依赖差异 API 的 scope 不符合本仓锁图。此次保留 submission、SBOM 回读和 required dependency-review，不关闭 #493。

| 核对项                     | 结果                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 完整锁图                   | 2 个 document，941 个 package identity，1,969 条依赖边，63 个 direct roots                                              |
| 当前 main SBOM             | 现有 verifier 通过上述 packages / edges / roots；creators 包含 `rivalhub-pnpm-lockfile`，不是原生接管证据               |
| 新 manifest 的原生锁图差异 | 925 个 identity，均为 added；没有多余 identity                                                                          |
| 缺失 identity              | 16 个：pnpm、14 个 `@pnpm/exe.*` 平台包、`pkg:generic/node@24.22.3`                                                     |
| 原生 scope                 | 925 项全为 runtime；其中 629 项按锁文件应为 development，含 21 个直接开发依赖                                           |
| package.json 的额外差异    | `@typescript/native` 被单列为 `npm:typescript@7.0.2`，不将它当成另一个正确锁定版本                                      |
| 告警读取                   | `GET /repos/Starfie1d1272/RivalHub/dependabot/alerts` 返回 403 `Resource not accessible by integration`；未验证告警内容 |

原生 scope 示例：`eslint@10.14.0`、`vitest@5.1.0`、`prettier@3.9.10` 均返回 runtime，锁图为 development。这里记录的是 dependency comparison API 的字段，不推断生产告警已如何分类或关闭。

## 如何隔离本仓提交快照

从该 main 创建临时分支 `chore/493-native-graph-probe`，仅将同一份 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 复制到 `native-dependency-graph-probe/`。探针提交为 `24a6b051`，完整 SHA 与输入哈希见 [native-comparison.json](native-comparison.json)。两个锁文件的 Git blob 完全相同。

探针推到普通分支后，读取以下原生依赖差异：

```bash
gh api 'repos/Starfie1d1272/RivalHub/dependency-graph/compare/1dc0f0cf...24a6b051?per_page=100'
```

API 返回 926 条记录：新路径锁文件的 925 条，以及该路径 package.json 的 1 条 alias 记录。既有 submission 只写根路径 `pnpm-lock.yaml`，且 workflow 只接受 main，因此不可能覆盖这个新路径；此次未提交任何探针 snapshot。差异查询验证了新路径依赖的发现，但没有开探针 PR，不能替代真实 PR 的 dependency-review 验收。

为保持主线安全覆盖，没有撤销主线 snapshot、暂停 workflow、刷新告警或改锁文件。探针只读取 GitHub 元数据，未运行应用或接触生产环境。

## 数据与复核

`native-comparison.json` 保存输入 commit/blob/SHA-256、API 响应 SHA-256、全部原生锁文件 purl 与 scope、缺失集合、直接开发依赖 scope 差异及唯一额外 manifest 行。它是原始响应的必要字段投影，不含 token 或完整漏洞元数据。比较时对 purl 作 URL decode 后再按 identity 匹配；alias 使用实际包 identity。

用基线的现有 owner 构建期望图；不再写一套锁文件解析：

```bash
pnpm exec tsx scripts/dependencies/snapshot.ts generate /tmp/rivalhub-493-expected.json
gh api repos/Starfie1d1272/RivalHub/dependency-graph/sbom > /tmp/rivalhub-493-sbom.json
pnpm exec tsx scripts/dependencies/snapshot.ts verify-sbom /tmp/rivalhub-493-sbom.json
```

期望集合来自 snapshot 的 `manifests["pnpm-lock.yaml"].resolved`。与记录的 `nativePackages` 比较可复算 16 个缺失 identity 和 629 个 scope 差异。基线的 941 个 identity 中，296 个为 runtime，645 个为 development。

冻结安装成功，安装前后锁文件 SHA-256 不变；本轮未改运行代码，不新增测试。已有 SBOM verifier 的成功只证明当前兼容层覆盖。原生依赖边/directness、真实 PR 新增依赖审查、原生告警及安全更新接管仍未验收；前置覆盖失败后未继续撤除兼容层。

## 上游依据

- [解析修复与刷新说明](https://github.com/dependabot/dependabot-core/issues/15904#issuecomment-6605704055)。
- [修复后仍有 scope 和环境 document 覆盖差异的反馈](https://github.com/dependabot/dependabot-core/issues/15904#issuecomment-6683900285)。

后续重新启动退出核验时，使用届时最新锁文件和新的无 submission 覆盖路径；本记录不承诺上游以后仍保持同样结果。
