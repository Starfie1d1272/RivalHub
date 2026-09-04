# Database migrations

RivalHub 的数据库变更只通过 active Drizzle migration chain 演进。

## Authority

- `src/db/schema/`：当前应用 schema model；
- `drizzle/migrations/`：active migration ledger 与 SQL；
- `drizzle/legacy-migrations/`：只读历史，不参与当前迁移；
- `pnpm db:push`：被显式阻止。

不要用手工 SQL patch、Supabase Dashboard schema edit 或裸 `drizzle-kit migrate` 建立第二套 production migration path。

## 标准流程

### 1. 修改 canonical schema / domain owner

先明确结构变化属于哪个领域、是否改变现有 invariant，以及上一稳定版本是否仍依赖被修改的 owner。

### 2. 生成并审查 migration

```bash
pnpm db:generate
```

生成后必须人工阅读 SQL。需要 RLS、policy、grant、trigger、backfill 或 fail-closed validation 时，把 custom SQL 放入同一个 active migration，而不是另建手工步骤。

### 3. 运行 migration checks

```bash
pnpm db:check
```

`db:check` 同时执行 changed-surface migration risk classifier 与 Drizzle chain check。

对于 DROP、rename、ALTER TYPE、SET NOT NULL、可能 rewrite / exclusive lock 等风险，必须按 checker contract 提供对应的 durable annotation 和可解释理由；annotation 只记录已经完成的审查，不是绕过安全证明的开关。

### 4. 用真实 PostgreSQL 回放

```bash
pnpm test:integration
```

migration、constraint、transaction、locking 与 backfill 不能只靠 unit mock 证明。

### 5. 验证 release compatibility

```bash
pnpm db:release-compat
```

该 gate 检查 previous stable shipped app 与 candidate migration 的 N/N+1 兼容边界。默认策略是：

```text
Release N+1: expand + backfill + app switch
Release N+2: old owner 不再被上一稳定版本依赖后再 contract cleanup
```

纯 additive migration 不要求机械拆成多个 release；会破坏上一稳定应用读写的变化必须跨 release 收敛。

## Staging

存在远程状态、锁、兼容性或 release 风险时，使用受保护 staging workflow rehearsal；不要从个人 shell 直接写 staging。

见 [`staging.md`](./staging.md)。

## Production

Production migration 只由正式 release workflow 通过 canonical protected wrapper 执行。不要：

- 手工跑 `ALTER TABLE`；
- 使用 `db:push`；
- 对 production seed/reset；
- 从 Preview 或本地环境继承 production credential；
- 在 release 之外单独推进 schema 而不推进对应应用版本。

正式发布顺序见 [`release.md`](./release.md)。
