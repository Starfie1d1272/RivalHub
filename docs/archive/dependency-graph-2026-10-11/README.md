# pnpm 12 依赖图实际回读

此前 SBOM 只有 22 个包且缺失 Next/React/pg 等应用依赖。使用 canonical main 原始锁文件生成 snapshot，提交 GitHub dependency submission API 后，实际 GET repository SBOM 逐项验证全部 949 个 resolved package identities 与 2002 条 dependency edges，无缺失。精确来源、lock hash、submission ID/时间、SBOM export 时间与代表包见 [低敏摘要](readback-summary.json)。源为 main `5e3805f59f9669d2f68b4f62abf72deeb7870cc7`，不是未提交工作树；yaml 在该源已是 transitive dependency，PR 只将解析器声明为直接 dev dependency。

捕获由 `scripts/dependencies/snapshot.ts generate <snapshot.json> <exact-lockfile>` 与 `verify-sbom <sbom.json> <exact-lockfile>` 执行。后者检查所有 purl 和 SPDX DEPENDS_ON 边；不是只验证 API 201/200，也不是仅检索代表包。只有依赖元数据写入 GitHub，未修改应用生产数据/余额/赛事/Storage。

此证据不代表 alerts API 权限或实际 npm updater 完成；alerts API 仍 403。恢复配置后的真实 Dependabot npm 更新与下次 scheduled run 需在执行 Issue 单独记录，不以本地冻结安装或 github-actions updater 成功替代。
