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

选中invitation也使用同一匿名/my/teams server preparation，不删除任何邀请/接纳/权限断言。另修正已有`signInProgrammatically`的URL predicate断言：安装的Playwright1.63实现会额外调用默认load的waitForURL，与其原注释“非关键subresource不得阻塞”不一致。改为poll实际pathname并保持同一目标值，所有调用者继续以实际业务locator建立UI证据，不使用networkidle、固定sleep或扩大timeout。冷两worker对照与最新head CI另记录结果；不以自动retry-pass换绿。

新准备/URL等待语义的冷两worker、retries=0对照：invitation16.7s、qualification26.1s，wrapper37.6s。与control wrapper35.8s相比没有宣称总耗时改善；准备成本仍完整计入。两项全部原断言通过，原失败记录保留。
