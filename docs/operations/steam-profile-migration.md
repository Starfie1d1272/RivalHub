# Steam 资料迁移与 remediation

Issue #687 建立 Steam64 主身份、官方资料缓存和 gameplay Steam identity 的共同基础。本文只说明迁移前置条件与受保护的 operator tooling；当前 PR 不执行 production migration、backfill、merge 或其它 remote write。

## Canonical owner

- `users.steam64` 是当前 primary Steam64；`steam_profiles` 是以 Steam64 为键的官方资料缓存，provider credential 只在服务端使用。
- `src/lib/identity/gameplay-steam.ts` 是 primary/observed gameplay identity 的唯一冲突、解析、记录和撤销 owner。后续 #686 应复用这里的 resolver 与 `recordGameplaySteamIdentityInTx` / `retireGameplaySteamIdentityInTx`，不得再建第二套 resolver。
- `user_gameplay_steam_ids` 保存历史 gameplay identity；`profile_change` 与 `admin_confirmed_alternate` provenance 必须保持可区分。primary 从 X 改为 Z 时，X 在同一事务中保留为 active historical identity。

## Migration precondition

0052 会按 active `users.steam64` 建立 partial unique index，并为 Steam64 加 17 位 shape check。它不会吞掉重复值：任一 active duplicate 或 invalid value 都应使 migration fail closed，先由 operator 完成独立的人工 remediation。不会自动合并用户、猜测归属、回填历史身份或写入 production。

本 PR 的 0052 不物理 `DROP` `users.steam_name`、`users.steam_profile_url`、`users.avatar_url`：上一稳定版本仍可能读取这些列，仓库的 N/N+1 release-compat 门禁要求先经过兼容窗口。这三个列仍是旧版本的 rollback shadow，位于当前 Drizzle application schema 之外；`steam_profiles` 仍是新应用唯一 authority。当前 primary 的官方 projection 在 cache upsert、refresh 和 backfill 时窄幅同步到 legacy shadow；primary 变更或移除时先清空旧 shadow，避免旧版本读到另一位用户的资料。待本版本部署并成为上一稳定版本后，由 `0053_steam_profile_contract_cleanup` contract-cleanup migration 删除这三个 legacy 列；Preview mirror 的 schema policy 以同一 lifecycle marker 拒绝 cleanup 后 shadow 重新出现。禁止在本 PR 中手工 remote patch 或提前删除。

Production 只读诊断：

```bash
pnpm db:production:steam-profile:remediation
```

该命令必须通过现有 production project/host confirmations，只打开 `REPEATABLE READ READ ONLY` transaction，并输出 duplicate Steam64 的 user IDs、invalid 值和 `migrationReady`。它不执行 `UPDATE`、`DELETE`、merge 或 migration。Local PostgreSQL 可用 `RIVALHUB_DB_TARGET=local` 与明确的 loopback `DATABASE_URL` 运行：

```bash
pnpm db:steam-profile:remediation
```

## Cache backfill

Migration 完成且 provider credential 已由受保护环境提供后，先 dry-run，再按结果执行幂等 backfill：

```bash
pnpm db:production:steam-profile:backfill
pnpm db:production:steam-profile:backfill --apply
```

`--apply` 只允许通过 protected production wrapper，并额外要求 `RIVALHUB_STEAM_PROFILE_WRITE_CONFIRM=I_UNDERSTAND_STEAM_PROFILE_CACHE_WRITE`。backfill 只 upsert 成功的官方 projection；provider 未找到的 Steam64 保持 unresolved，provider 整体失败时不写入 cache。为修复 N/N+1 rollback shadow，apply 会写入每个成功解析的 current primary，即使 `steam_profiles` 中已有相同资料；重复运行仍是幂等的。`--limit N` 可用于受控分批，但 production release gate 使用完整集合。

Release workflow 对创建 `steam_profiles` 的 migration 强制执行以下受保护顺序：

```text
production migration → production DB verify
→ Steam profile backfill（STEAM_API_KEY + explicit write confirmation）
→ read-only coverage/shadow verify
→ exact candidate smoke → routing
```

coverage verify 在 `REPEATABLE READ READ ONLY` transaction 中确认所有 active current primary 都有 cache，并且 legacy shadow 与官方 projection 一致；provider 未解析、backfill 失败或 coverage 不通过都会阻止 candidate routing，旧 Production 保持不变。对应命令为 `pnpm db:production:steam-profile:coverage`。当前 feature PR 只提供代码、脚本和 protected workflow wiring，不执行 production migration、backfill、coverage、merge 或其它 remote write。

该 backfill 不改变 `users.steam64`、不建立 gameplay mapping、不合并账户，也不将官方资料反向写回用户冗余字段。生产执行仍必须由 release/operations owner 按 [`release.md`](./release.md) 和数据库 migration 流程授权。

## Runtime contract

- Settings 的 Steam64 lookup 立即访问 Steam provider；只有成功的官方资料才写入 `steam_profiles`。
- 普通页面只读 cache；当前 primary 的 scheduled refresh 由 `refresh-steam-profiles` 处理，历史/未知 Steam64 不做 periodic full refresh。
- provider 临时失败时已有 primary 保留 last-known-good；new/changed primary fail closed。cache miss 只显示明确的 graceful fallback，不在 render path 直接调用 Steam API。
- UI 只让用户填写 Steam64；persona name、profile URL 和 avatar 是 read-only provider projection。

## Follow-up boundary for #686

#686 当前仍是独立的未合并 PR。它后续应从自己的 branch rebase 到包含 0052 的 `main`，移除平行的 schema/resolver，并把 Demo revalidation、season-admin workbench 和审计 presentation 绑定到本基础 owner；这些产品层实现不属于 #687。
