# RivalHub 工程约束

## 项目与命令

RivalHub 是高校电竞赛事管理平台；当前内置 Rivals 与 Major 两套平行体系。技术栈为 Next.js App Router、TypeScript strict、Tailwind/shadcn、Supabase、Drizzle、Vitest 与 Playwright。

```bash
pnpm dev
pnpm dev:local
pnpm type-check
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
pnpm db:generate
pnpm db:check
pnpm db:local:bootstrap
pnpm db:local:reset
pnpm db:studio
```

完整测试入口见 `docs/testing.md`，运行/迁移边界见 `docs/deployment.md`。

## Architecture invariants

1. 业务写入只通过 Server Actions；Cron 才使用 API Route。
2. 赛事业务按 capability 字段分支，禁止以 `season.kind` 作为功能判断。
3. 管理操作必须写入 `audit_logs`。
4. Server Components 为默认；Client Components 只用于表单、局部交互、倒计时或批准的 Realtime。
5. Realtime 仅限 `draft_state`、`draft_picks`、`captain_votes`；数据库事务 commit 后才可广播。
6. 选秀必须在事务中使用锁和 `client_request_id` 幂等保护。
7. 任何 `brackets-manager` 调用必须经过 `@/lib/bracket` 适配层。
8. Server Action 返回 `ActionResult<T>`，以 `ok()` / `fail()` 表达预期错误；错误码以 `src/lib/errors.ts` 为准。
9. 时间存 UTC，展示层转换为 Asia/Shanghai。
10. Server-side query 可以读取业务所需私密字段；公开 RSC payload 与 Client Component props 必须经过明确 public DTO/read model，不能直接序列化内部查询对象。
11. Server Action 负责鉴权、validation 与 transaction boundary；可复用复杂 domain logic 下沉至 `src/lib/<domain>/`，避免 action/page 重复实现。
12. 新增 formatter、fallback、derived state、modal、database test harness 或 domain helper 前，先搜索已有 canonical owner；禁止在 page/action/component 内建立第二套相同业务规则。

## Database and security

- active Drizzle migrations 是唯一 migration authority；禁止用 `db:push` 应用 active chain。
- Local 数据库写入只走 `db:local:*`，并验证 loopback target；不从 `.env.local` 回退到远程连接。
- staging/preview 必须先确认独立 Supabase project，才能进行 seed、migration rehearsal、写入型 E2E 或赛事模拟。
- production、staging、local 的数据库和密钥必须隔离。远程操作使用显式 target、host confirmation 与授权变量。
- Server-only database 是业务读写 owner；Data API 默认拒绝。新增 direct Supabase client 或 Realtime table 时，同一变更必须包含 explicit GRANT、RLS policy 与正反例测试。
- `SUPABASE_SERVICE_ROLE_KEY`、session secret、Cron secret 及其他私密变量不得进入客户端、日志或 Git。

## Auth and permissions

- 正常账号和管理员使用 Supabase Auth、`public.users.role` 与 `rivalhub-session`。
- `admin_users` / `rivalhub-admin` 仅是 emergency compatibility path。
- Fresh deployment 通过配置的 `RIVALHUB_OWNER_EMAIL` 在尚不存在 `super_admin` 时一次性 bootstrap；不得把“第一个注册用户”当作 owner。

## Branches and releases

- `main` 是 production branch，`dev` 是下一版本 integration/staging branch；二者均不 force push，只通过 PR 合入。
- 常规工作从 `dev` 建 `feat/*`、`fix/*`、`docs/*` 等分支，PR base 为 `dev`；production hotfix 从 `main` 开始并回同步到 `dev`。
- 面向协作者的 Issue / PR 标题与正文、Changeset 摘要和 release note **默认使用中文**；真实代码名、字段名、协议名、库名和其他必要技术术语可保留英文。
- 会进入版本发布、影响用户/管理员体验或 production runtime/data contract 的 `feat` / `fix` / `refactor` / migration / runtime security 变更，必须在**同一个 feature PR** 中提交对应 `.changeset/*.md`；不要把 changeset 留到发版时补写。
- 纯文档、纯测试、CI/开发工具，以及仅 development dependency 且不改变 shipped runtime / 用户行为的变更，可以不写 changeset；PR 中应明确写出“无需 changeset”及原因。
- Changeset 摘要是面向 release/CHANGELOG 的用户可读说明，默认用中文描述可观察影响，不把内部实现细节或 commit message 原样当作 release note。
- feature PR 合入 `dev` 时关联 Issue 使用 `Refs #N`；不要依赖 `Closes #N` 在非默认分支自动关 Issue。Issue 在对应变更进入 `main` / release convergence 后统一关闭。
- 版本、CHANGELOG 与 release path 由 Changesets 和 `.claude/skills/release.md` 共同定义。禁止手改 `package.json` version，且仅在 release commit 已进入 `main` 后创建 release tag。

## Documentation authority

- 赛事政策：`docs/rules/**`。
- 当前实现：code、schema、active migrations、tests 与 active technical docs。
- 已接受未实现设计：`docs/decisions/**`。
- 历史过程与历史验收：`docs/archive/**`。

详细入口见 `docs/README.md`。`CLAUDE.md` 只引用本文件，避免平行工程手册。
