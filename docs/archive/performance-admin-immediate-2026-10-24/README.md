# 后台即时验收

这些是可在发布前完成的有界验收，不归入长期RUM。全部使用隔离loopback fixture，retry=0、显式trace；trace和认证资料只留忽略目录。采样基于#1094等价业务代码，加目录自身Suspense边界；不证明生产p75/p95。

| 项目 | 实际证据 |
| --- | --- |
| A-SHELL/DIRECTORY | 登录的browser context在空白页发实际/admin root Flight，验证200/text-x-component；pg_stat_statements统计sidebar与page共1次目录SQL；撤权后新页面请求明确拒绝。背景流量排除在计数范围。 |
| A-AUDIT browser | 65条日志，page1为50行，page2为15行，直接URL/back/forward一致；50行覆盖30个distinct target ID、2类target，标签全部包含真实fixture队伍名；专用match-label SQL1次。 |
| A-AUDIT 30类型PG | 50引用、30类，12类现存目标、18类missing fallback。串行executor与有界pool逐字段标签相同，40→39SQL、21→18返回行、1434→1204结果JSON bytes，最大在途1→3。注入25ms PG延迟的单样本524→228ms；不是生产网络/锁并发/p95。 |
| A-OVERVIEW | 复用canonical选择/同步/冻结的32队160人；真实浏览器显示32 / 32队，完整Flight不含抽查成员ID（17.6秒）。PG读验证非空counts、readiness/prestartPhase均null、成员未下发。 |
| A-EDUREVIEW | overview临时等待5000ms，真实pending CHSI证据已出现，状态筛选完成URL导航时overview仍是fallback（9.1秒）。恢复源码后cmp一致；生产不含延迟或测试开关。 |

目录page使用自己的Suspense边界；Next的instant配置按segment生效，layout的instant=false不会豁免page的验证。fallback不含授权资料，不标记content-ready。之前用networkidle等待会被页面背景流量干扰；最终用实际内容/URL与隔离的授权Flight请求验收，没有延长timeout或删除失败断言。

Overview浏览器复用原PG成功冻结case，通过测试专用文件桥临时保留fixture。桥等待时无事务保持；浏览器完成后释放，原幂等/快照校验继续运行并清理。PG的临时playing状态仅选择已开赛summary分支，未声称执行正式赛事启动workflow，冻结事实确由canonical函数生成。桥路径只在本地测试环境传入，不增加生产路由或凭据。

普通复现：

```bash
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:e2e -- tests/e2e/flows/admin-immediate-boundaries.spec.ts --project=chromium --workers=1
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:integration -- tests/integration/db/admin-audit-type-batch.test.ts tests/integration/db/major-prestart-selection.test.ts
```

慢overview仅在独立本地fixture checkout中应用已审查的窄补丁，并在结束后反向恢复，不能提交应用后的page：

```bash
git apply docs/archive/performance-admin-immediate-2026-10-24/education-delay.patch
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 RIVALHUB_EDU_SLOW_PROBE=1 pnpm test:e2e -- tests/e2e/flows/admin-immediate-boundaries.spec.ts --grep 慢概览 --project=chromium --workers=1
git apply --reverse docs/archive/performance-admin-immediate-2026-10-24/education-delay.patch
git diff -- src/app/admin/education-verifications/page.tsx
```

30类PG结果不冒充30类全部现存实体，browser的30 ID也不冒充30类。其他权限、legacy/tombstone、已撤设备边界沿用既有audit-presentation真实PG用例。这里没有部署改善、完整生产池预算或所有角色/冷热组合的断言。

35页最终覆盖快照见 [route-status-final.json](route-status-final.json)：逐页分开实现、交付、即时验收与长期生产观察；7组补项和3view/A-WB5分别记录。尚无证据的即时缺口显式列出，不以长期RUM代替。该快照不表示分支已合并或版本已部署。

A-AUDIT原验收的越界页曾真实PG复现：65条中page999空集合，正常末页15条。修复后正常page/count仍并行，只有越界且非空时补读末页，标签投影只执行一次；空结果不补读，不安全整数回默认页，Client根据同一total显示有效页。3个真实PG、2个组件通过；浏览器20.4秒通过page999显示2/2和15行、下一页禁用，以及原直接URL/back-forward/50行标签。URL保留原输入直到用户导航，未引入额外Client list effect。
