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

如果领域同时依赖 Supabase Storage，private bucket 的 contract 也必须由同一条 active migration 在 `storage.buckets` 可用时幂等收敛；plain PostgreSQL replay 可以条件跳过 Storage schema，但不能跳过对应的 public schema/constraint。不要在 Supabase Dashboard、`supabase/config.toml` 或第二条 provider migration chain 复制 bucket owner。

### 3. 运行 migration checks

```bash
pnpm db:check
```

`db:check` 同时执行 changed-surface migration risk classifier 与 Drizzle chain check。

对于 DROP、rename、ALTER TYPE、SET NOT NULL、可能 rewrite / exclusive lock 等风险，必须按 checker contract 提供对应的 durable annotation 和可解释理由；annotation 只记录已经完成的审查，不是绕过安全证明的开关。

Release Plan 使用同一 owner 将 active migration SQL 归类为 `none`、`forward-compatible` 或 `irreversible`；未识别的 SQL 按 `irreversible` fail closed。`forward-compatible` migration 进入 PostgreSQL 17 replay 与 production migrate/verify；`irreversible` migration 在 production mutation 前还必须完成 DB-only encrypted checkpoint。Storage object mutation 另行要求 full checkpoint。

### 4. 用真实 PostgreSQL 回放

```bash
pnpm test:integration
```

migration、constraint、transaction、locking 与 backfill 不能只靠 unit mock 证明。

Release workflow 的 plain PostgreSQL 17 rehearsal 使用：

```bash
pnpm db:release-rehearsal
```

该命令复用 `preparePg17Database()` 与 `scripts/db/migration-replay.ts`；CI PostgreSQL lane、Release 和本地 `db:local:migrate` 不维护相互漂移的 replay runner。所有 replay / protected remote migration 通过 `canonical-migrate.ts` 执行原始 active chain，在含 `ALTER TYPE ... ADD VALUE` 的 migration 后提交事务，再执行后续 migration；每一阶段仍由 Drizzle ORM migrator 维护原始 SQL hash 与 ledger，避免 PostgreSQL 在同一事务中使用尚未提交的 enum value。CLI wrapper 在独立子进程加载已校验的目标配置，使用 canonical `postgresConnection` 创建 node-postgres Pool；不把 URL 与显式 TLS 选项交给会丢弃 SSL 参数的 Drizzle Kit migrate 分支。

### 5. 验证 release compatibility

```bash
pnpm db:release-compat
```

该 gate 检查 previous stable shipped app 与 candidate migration 的 N/N+1 兼容边界。默认策略是：

```text
Release N+1: expand + backfill + app switch
Release N+2: old owner 不再被上一稳定版本依赖后再 contract cleanup
```

Issue #806 的 `0073_careless_pretty_boy` 是明确的未开放功能清理例外：赛事负责人确认推演从未开放并授权直接删除 `prediction_scenarios`，不做 N/N+1 staged rollout。兼容 checker 只对该精确 migration/relation 记录这一授权，其它 owner 继续按默认规则检查。

纯 additive migration 不要求机械拆成多个 release；会破坏上一稳定应用读写的变化必须跨 release 收敛。

## 社区奖名单的 expand / reader 切换

`community_award_recipients` 是完整名单事实。扩展迁移保留旧 `recipient_user_id`、原 CHECK 和单人读取契约，回填所有历史获奖记录，不依据当前赛季是否有结果决定是否迁移。N 版本继续读取一个真实获奖者；N+1 从关系表批量读取完整名单，新 writer 在同一事务维护关系表和首位获奖者投影。延迟约束在提交时校验状态、名单与人数上限，旧 writer 的单人更正由数据库桥接到关系表并补存完整旧/新结果与理由审计；多人规则或提前结算策略上的旧 writer 会被拒绝，不能静默覆盖新结果。

部署顺序为 expand/backfill → 部署完整名单 reader/writer → 排空 N 版本请求 → 管理员显式启用多人或提前结算规则。滚动重叠期间只运营原单人、整届结束策略；N 的公开页无法展示多人，因此不能在旧 reader 尚有流量时发布新的多人结果。已有公开奖项内容和历史结果不在迁移中被重解释。回退 N 应先停止新结奖/核验操作，保留数据库扩展和已有名单，不能用旧 reader 作为多人结果的完整展示。

本轮不删除单人投影或桥接 trigger；仅在上一稳定 shipped 应用不再引用旧字段后，后续 release 才可独立执行 contract cleanup。兼容与回填由 PostgreSQL migration spec 实测，生产排空与策略启用属于发布/运营操作，不由普通 feature PR 执行。

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

## 历史身份与 BP 兼容性

涉及 additive 0096/0097/0098、durable generations 或 receipts 的迁移和恢复，应保留相应记录。旧 identity registry 不识别 receipt 外键时 merge 会失败，旧 BP worker 也不消费新 pending generation；恢复这些功能时需使用兼容版本并验证，不能仅凭首页恢复判断业务已经恢复。
