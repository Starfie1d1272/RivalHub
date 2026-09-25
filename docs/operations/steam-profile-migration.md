# Steam 资料架构与运维

本文说明 Steam64 主身份、官方资料缓存（`steam_profiles`）以及 gameplay Steam identity 的系统边界与运维工具。

## Canonical owner

- `users.steam64` 是用户当前 primary Steam64；`steam_profiles` 是以 17 位 Steam64 为主键的官方资料持久缓存（personaName、profileUrl、avatarUrl），Steam provider credential 仅在服务端使用。
- `src/lib/identity/gameplay-steam.ts` 是 primary/observed gameplay identity 的唯一冲突、解析、记录和撤销 owner。
- `user_gameplay_steam_ids` 保存历史与比赛关联的 gameplay identity；`profile_change` 与 `admin_confirmed_alternate` provenance 保持可区分。primary 从 X 改为 Z 时，X 在同一事务中保留为 active historical identity。
- `users` 物理表中仍暂时保留 `steam_name`、`steam_profile_url`、`avatar_url` 三个兼容列，但应用层 Drizzle schema 已不包含它们，应用运行时也不再对其进行任何读写维护。`steam_profiles` 是官方资料唯一持久化事实来源。这三个物理列将在下一版本作为单独的 cleanup migration 进行 DROP。

## Database constraints

- `users.steam64` 具备 partial unique index（仅针对 `status = 'active' AND steam64 IS NOT NULL`）与 17 位数字正则约束（`users_steam64_shape_check`）。
- `steam_profiles.steam64` 具备 17 位数字主键与 shape check。
- `user_gameplay_steam_ids` 的 active 记录在同一 Steam64 上唯一，状态流转受到 shape check 与外键保护。

## Tooling & Verification

### 1. Production 只读诊断
```bash
pnpm db:production:steam-profile:remediation
```
该命令只在 `REPEATABLE READ READ ONLY` 事务中检查 duplicate Steam64 的 user IDs、invalid 值和 `migrationReady`。Local PostgreSQL 可通过 loopback URL 运行：
```bash
pnpm db:steam-profile:remediation
```

### 2. Cache backfill
当需要为 active primary 批量补充或更新官方资料缓存时运行：
```bash
pnpm db:production:steam-profile:backfill
pnpm db:production:steam-profile:backfill --apply
```
`--apply` 要求显式设置 `RIVALHUB_STEAM_PROFILE_WRITE_CONFIRM=I_UNDERSTAND_STEAM_PROFILE_CACHE_WRITE`。backfill 仅向 `steam_profiles` 写入成功解析的官方资料，不修改 `users.steam64`，不建立 gameplay mapping，不合并账户。

### 3. Coverage verify
```bash
pnpm db:production:steam-profile:coverage
```
在 `REPEATABLE READ READ ONLY` 事务中验证所有 active current-primary `users.steam64` 是否均已存在于 `steam_profiles` 缓存中。

## Runtime contract

- **Settings / Account binding**：用户提交 Steam64 时立即查询 Steam provider；仅在官方资料确认有效后才允许事务提交并写入 `steam_profiles`。
- **Periodic refresh**：当前 active primary 的定期刷新由 `refresh-steam-profiles` 任务负责；历史或仅在 Demo 中观察到的 Steam64 不参与 6 小时周期全量刷新。
- **Operator review / cache-miss**：Demo review 等受权管理员链路对观察到的陌生或历史 Steam64 按需批量获取并缓存官方资料（`loadOrFetchSteamProfiles`）。若 provider 失败或未找到，优雅降级，不阻塞管理员审核，且不影响比赛身份验证裁定。
- **Provider failure**：provider 临时不可用时，已有 primary 保持 last-known-good；新设/更换 primary 则 fail closed。公共渲染路径绝不直接向 Steam API 发起请求。
- **UI & Projection**：UI 仅允许用户输入 Steam64；昵称、个人资料链接及头像是来自 provider 的只读投影。
