# Supabase Auth ↔ canonical user 一致性审计

## 目的与 owner

`src/lib/identity/auth-consistency.ts` 是 Auth ↔ RivalHub canonical user 一致性分类和 repair-plan 的唯一业务 owner。它只处理 Auth、`public.users` 与 active `user_identities` 的归属关系，不根据昵称、QQ、Steam 或报名历史推断 person。

审计脚本读取完整的 Supabase Auth user 分页和 PostgreSQL active user/identity 快照，在内存中完成 reconciliation。PostgreSQL 快照必须在 `READ ONLY` transaction 中读取，并确认 `transaction_read_only = on`。

## 分类

| 分类 | 含义 | 处理边界 |
| --- | --- | --- |
| `consistent` | 已有直接 Auth 归属，或 Auth email 能唯一解析到一个 canonical user；缺少 credential row 时可生成受控 bind plan | 仅在 plan 明确为 `safe_self_heal` 时 repair |
| `pending_signup` | Auth user 未确认、没有 canonical owner，且创建时间在 grace window 内 | 正常等待状态，不报警、不 repair |
| `stale_auth_orphan` | Auth user 没有 canonical owner，且已超过 grace window | 已确认且有 email 的记录可生成 create plan；未确认或缺 email 时阻断 |
| `public_without_auth` | active `public.users` 的 legacy `auth_id` 或 active Auth credential 缺失/不可解析 | 高严重度，只报告并人工复核 |
| `identity_owner_conflict` | provider subject、normalized email、legacy owner 或 active identity 指向多个/不存在的 owner | critical，fail closed；不自动任选 owner |

默认 signup grace window 为 24 小时，可用 `--grace-hours` 覆盖。分类函数接收显式 observation time，便于复核时保持 deterministic。

## 只读审计

普通审计命令要求调用方显式设置 `RIVALHUB_DB_TARGET`、数据库连接串、Supabase URL 和 service-role key；未声明 target 时拒绝运行。输出为结构化 JSON，包含分类、内部 UUID、时间、identity ownership evidence、healability、blocker 和 conflict code，但不输出完整 email、token 或其它 credential。

本地环境应只使用 loopback PostgreSQL 和 Local Supabase credential：

```bash
RIVALHUB_DB_TARGET=local \
DATABASE_URL='<local loopback postgres url>' \
NEXT_PUBLIC_SUPABASE_URL='<local loopback supabase url>' \
SUPABASE_SERVICE_ROLE_KEY='<local service role key>' \
pnpm db:auth-consistency-audit
```

Production 必须使用受保护 wrapper。它会复用固定 production database target 校验，验证 Supabase URL 的 project ref 与代码中的 production project 一致，并只向 audit child process 注入所需 Supabase credential：

```bash
RIVALHUB_DB_TARGET=production \
RIVALHUB_PRODUCTION_PROJECT_CONFIRM='<production project ref>' \
RIVALHUB_PRODUCTION_DB_HOST_CONFIRM='<production pooler host:port>' \
DATABASE_URL='<existing production runtime database url>' \
NEXT_PUBLIC_SUPABASE_URL='<fixed production supabase url>' \
SUPABASE_SERVICE_ROLE_KEY='<production service role key>' \
pnpm db:production:auth-consistency-audit
```

不要把完整 JSON、环境变量或 service-role key 写入公开 Issue、PR、普通应用日志或聊天记录。生产 acceptance 应保留受限运维位置中的原始 audit evidence，并在 Issue/PR 只记录必要的分类和收口结论。

## Target-scoped repair

指定单个 Auth UUID 时，默认只生成 dry-run plan：

```bash
pnpm db:auth-consistency-audit --repair-auth '<auth uuid>'
```

只有显式加 `--apply` 才允许写入；production apply 还必须经过 production wrapper，并设置 `RIVALHUB_ALLOW_REMOTE_DB_WRITE=production`。repair 始终调用 `resolveOrCreateCanonicalUserInTx()`，使用 `admin_migration` provenance，并在同一事务中写入 `user_identity.auth_consistency_repair` audit fact。它不通过通用 SQL 绕过 identity invariant，也不删除 Supabase Auth user。

以下情况永远不会自动 repair：`public_without_auth`、任何 `identity_owner_conflict`、未确认 Auth email、缺失 Auth email，或执行期间 canonical owner 与 dry-run plan 不一致。冲突应转入既有 identity merge/reconciliation 人工流程。

## 已知 production stale orphan 的收口

Issue #534 中已知的两条 2026-05-15 历史 Auth-only 记录，必须先由 production read-only audit 稳定分类为 `stale_auth_orphan`，并确认不存在业务事实或 canonical identity 冲突，再逐条审阅 dry-run plan。部署本身不修改或删除这两条 Auth 记录；repair、保留或其它人工收口是独立的 production mutation，必须留下受限 audit evidence。

合法的后续 password login / signup confirmation 仍会通过 canonical resolver 自愈；跨 Auth 与 PostgreSQL 的失败窗口不由本 runbook 扩展为分布式事务。
