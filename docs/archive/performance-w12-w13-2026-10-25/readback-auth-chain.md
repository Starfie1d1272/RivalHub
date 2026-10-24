# AS13 / AS15 / AS16：真实应用授权链撤销补验

`tests/integration/db/operation-readback-auth-chain.test.ts` 补充原 readback 集成测试中的权限证据限制。授权函数、iron-session、application registry、角色和赛事 grant 读取均使用实际实现；仅 Next cookie/connection 平台传输与缓存失效适配为测试实现，数据库 logger 只观测实际 SQL。

使用既有 Mizar fixture 的普通非代表参赛者，角色保持 user。复用仓库 `buildLocalAppEnvironment` 已定义的本地 session 配置；签名 cookie 仅存在测试内存，应用 session 在隔离克隆 PostgreSQL 中创建并撤销。无新生产账户、超级管理员、provider 凭据、密码或持久 secret，也不调用 Supabase/邮件 provider。

实际验证顺序：

1. 插入该 fixture 自有赛事 grant，经实际 `createUserSession` 签发应用 session、iron-session 保存/解封 cookie；三个 typed readback 均成功。
2. 实际删除 grant，保留同一签名 cookie 与有效 application session。名单/录像/提议三入口均 FORBIDDEN，且每次实际读取 application_sessions 和 season_admin_grants；私有名单成员、录像、提议时间/处理方式 SQL 均为零。
3. 恢复 grant 后三入口再次成功，排除坏 cookie 或失效 fixture 导致的伪拒绝。
4. 实际删除 application session，保留原签名 cookie；三入口均 UNAUTHORIZED，私有读取仍为零。读取未新增业务 audit。

命令：

```sh
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:integration -- tests/integration/db/operation-readback-auth-chain.test.ts
```

1 项真实 PostgreSQL 集成通过，tests 类型与文件 ESLint 通过。此补验从应用 session owner 开始，既不冒充上游 provider 登录测试，也不冒充真实 HTTP/浏览器传输或管理员撤权 UI 测试；撤销的是实际 DB grant/registry 事实。原九窗口与 body-budget 的既有证据限定保持不变。
