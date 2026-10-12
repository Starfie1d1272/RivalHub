# Request changes 的证据与修正

## 独有预测 oracle

只恢复原用例 `replaces upstream choices, discards later rounds/stages, and leaves the input unchanged` 及其原 `complete` fixture helper，不恢复旧模拟器矩阵。正常实现通过；隔离 worktree 中将 `replaceSimulationChoice` 的空 `next` 改为预载旧 `choices`，该用例在“所有保留 key 都属于 stage1/r1”断言失败。探针先通过正常实现再注入，随后还原生产源码。没有把旧矩阵藏入新参数化/巨型 it：恢复的是原有单项 oracle，101 个 unit 是实际运行展开计数。

原 100 unit 全过不能证明 upstream invalidation，旧报告中的退役说明不能作为安全等价证明。其它未恢复的 profile、slot judgement、playoff sibling 等 oracle 仍明确缺失，按相关产品规则变化提供聚焦验证。

## Major 本地 30 秒未完成

在最终测试逻辑未改的情况下运行单一 Major flow，retries=0，trace=on：

| 对照 | 结果 | 证据 |
| --- | --- | --- |
| 原 favicon readiness / 首次路由 | 失败，尚未完成登录 | 首个浏览器 goto 31.964 s；网络 /my/teams GET 约25.2 s，跟随 login 约4.1 s；30秒用例预算已耗尽 |
| 保留 dev 缓存、再次启动 Next | 失败，最终“当前参与”标题断言未完成 | goto /my/teams 仍约17.1 s，register约5.1 s；Team、Entry已经成功创建，但 /my/competitions 页面验证未完成 |
| 删除本仓 .next/dev 后，Major route readiness | 通过全部原断言 | case **20.4 s**，整个 browser wrapper **44.3 s** |

这是准备/编译成本的对照，不能把前两次失败说成产品已回归，也不能隐藏失败并声称此前本地全绿。修改 `playwright.config.ts`：当实际选择 Major entry 时，既有 webServer readiness URL 使用匿名 /my/teams（Playwright跟随到login），让该 dev 路由在 server preparation 阶段编译。其它显式选择的 flow、特别是独立 LIVE，仍用 favicon；production override不变。实际浏览器依然重新验证匿名重定向、真实 Supabase 登录、Team/Entry创建和两页 canonical read-back，业务断言一个未删。

没有改用例30秒、expect10秒或FULL180秒预算，没有增加retry/skip、没有mock认证或绕过真实UI。准备成本仍进入整个 browser wrapper 与 required wall time；不把20.4秒当作整个冷启动成本，也不声称一次通过证明稳定性能。`--list` 实际配置验证 Major=/my/teams，LIVE=/favicon.ico。Next dev 现有阻塞预渲染警告仍存在；没有在清理中改产品路由或夹带 #941 hydration 修复。

## 精简候选的未完成部分

独审说明15项中只有2项优先重复、4项当前关闭的未来producer、9项存在明确覆盖损失。当前工具没有直接读取独审会话 `01a130a1-3b95-7178-8f62-6c68d9b0c09c` 的入口，GitHub reviews未提供清单，personal-context返回当前会话不可用，已请求转发。未取得精确清单前不按猜测称为重复或删除。当前计数429/3,381，12.689%；用户最新明确10%不是硬性要求，不再以数量作为验收阻塞，也不为比例削弱独有保护。候选留作真实重复/维护成本审查，不宣称所有剩余场景不可再删。

## 后续 CI 暴露的 invitation 分片

`81d4f46a` 的CI中，browser-6是team-invitations与major-qualification共同使用两worker。首次invitation在31.4s超时、retry在12.3s通过，failOnFlakyTests正确阻断，没有沿用旧head全绿。截图显示captain已经发出邀请、invitee位于待处理列表，同时Next仍Compiling；不足以精确判定接受动作回归。Major readiness选择没有影响该分片（此前仍favicon）。本地相同两worker/retries=0、清除.next/dev的对照两项通过（invitation23.9s，qualification31.8s，wrapper35.8s），说明CI失败有首次编译/执行预算因素，但不声称仅一次本地成功证明已稳定。

选中invitation也使用同一匿名/my/teams server preparation，不删除任何邀请/接纳/权限断言。曾尝试将已有helper的predicate URL matcher（隐含load）改为只poll pathname；该版本冷两worker零retry通过16.7/26.1s、wrapper37.6s，仍不足以证明其它SSR控件可交互。后续0ce12884的CI中event-logo首次SVG变更未出现客户端校验提示、retry才通过，故撤回这项等待语义调整，恢复原document load并修正误导注释。SVG负例、应用脚本加载与业务locator检查均保留，不夹带941产品修复。

## 浏览器环境的遥测边界

恢复load后的本地冷对照里，Logo业务断言完成但context.close触达既有45s预算，公开players导航在load期间耗尽既有30s；浏览器日志记录外部va.vercel-scripts.com开发遥测脚本TLS -202/加载失败。只在测试BrowserContext中用[Playwright公开的routing API](https://playwright.dev/docs/network#abort-requests)阻断这一非业务遥测域；默认context和显式多角色context共用同一准备owner。没有使用过时Chrome DNS标志、ignoreHTTPSErrors、networkidle、fixed sleep或更宽timeout，没有阻断应用/真实Auth/Storage/Realtime请求，也没有生产源码变化。

Routing会关闭浏览器HTTP cache，这一环境差异必须承认；Next router/RSC及服务器cache不由此替代。Logo的真实URL更换、公开read-back及旧对象删除仍逐项断言；生产遥测可用性和浏览器HTTP cache不属于本轮证明。独立LIVE继续真实Broadcast/缓存proof任务，sessionStorage与receiver生命周期并未mock。

清除本仓.next/dev、两worker、retries=0的最终Logo/公开查询对照：Logo26.6s、公开查询23.7s，wrapper30.0s，全部原业务断言通过。trace记录默认与额外公开context的遥测请求均被阻断，原失败保留。邀请分片在恢复load与相同遥测隔离后的冷两worker、零retry对照：invitation14.0s、qualification25.7s，wrapper38.0s，原断言全通过。最终head完整CI结果记录在PR，不沿用旧head成功。

本地LIVE首次验证在producer启动即遇真实Supabase Broadcast上游HTTP500，尚未进入页面消费；没有mock或放行500。显式启用LIVE的local services报告ready后仍在首个Broadcast上游HTTP500失败，尚未进入页面消费。producer/API/timeout没有修改，不能称本地LIVE全绿；该环境缺口与最新head独立CI结果一并保留。
