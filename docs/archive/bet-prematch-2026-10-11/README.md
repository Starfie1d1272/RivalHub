# 单图总回合赛前参与：本地视觉证据

基于 main `a79821f15dd385f04905be98696fd542a3254695`，使用隔离 Local Supabase 账号与模拟赛事，经真实登录、启用 BET、领取积分和投入入口取证。数据与余额均为本地测试数据。

- [桌面 1440px](desktop-prematch.png)
- [窄屏 320px](narrow-prematch.png)

截图呈现 BP 前三个按图序开放的总回合盘口，第1图投入 100 积分，继续复用现有百分比、奖池与积分条。人工核对：图序和地图待定可辨认、三图均可达、已投选项保留、窄屏页面没有横向溢出。确认弹窗另外通过浏览器断言核对图序。

重现：`RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:e2e -- tests/e2e/flows/bet.spec.ts --project=mobile-chrome --workers=1 --reporter=line`。同一流程验证 BP 补名后投入保留、开图后对应选项禁用且后续图仍可参与。规则边界与并发证据由 domain 与真实 PostgreSQL 测试拥有；截图采集入口现已移除；历史截图不证明生产已上线。
