# Preview 脱敏镜像运行手册

RivalHub 的服务器预览站固定连接 `rivalhub-dev`，不连接 production，也不读取 #569 的正式 R2 灾备 artifact。`rivalhub-dev` 是可牺牲 shared staging：Preview 可完整读写，下一次 refresh 覆盖测试数据。镜像由受保护的 `Refresh Preview Mirror` workflow 生成：production job 只读导出，dev job 在固定的 `dtdzxnzjtohzjmfkighg` 上重置和导入。

生产导出账号 `rivalhub_preview_exporter` 通过 Session Pooler 连接，仅调用数据库私有 schema 的投影函数并读取迁移哈希。函数按公开赛事过滤赛季、报名及相关比赛谱系。教育证据和生产管理员授权不进入快照，Preview 管理员使用合成身份。公开 Storage 读取限于允许的对象路径和总字节数。

首次启用时先发版应用 `preview_reader` 迁移，再由维护者给该角色启用登录并将随机密码设置为 Production Environment 的 `RIVALHUB_PREVIEW_DB_PASSWORD`。核对凭据只可读取投影，直接访问用户邮箱、Auth、审计及写入请求应失败。更新投影时通过 `pnpm exec tsx scripts/db/preview/reader-sql.ts` 为 active chain 生成新的 `*_preview_reader.sql` custom migration，使用 `--check` 核对最新定义。
## 刷新边界

- 需要更新 Preview 时从受保护的 `main` 手动 dispatch，导出与导入程序使用该次 dispatch 的同一个 SHA。默认恢复生产所用的 migration prefix。只有显式启用 `apply_current_migrations` 时，才应用 `migration_ref` 的追加迁移。备用分支只 checkout migration 目录，导入程序在重置 dev 前验证它包含镜像的完整 source prefix。Preview 与 staging rehearsal 各有入口。
- production job 使用只读事务读取源端，用公开 Storage URL 读取允许的公开素材。runner 在临时目录压缩快照，用独立 Preview age recipient 加密，Actions artifact 只含密文。staging runner 用 staging Environment 的独立 identity 解密，导入后清理临时明文。发布和每日备份独立运行。
- `refresh-dev` 失败且密文仍在一天保留期内时，优先使用 GitHub Actions 的 **Re-run failed jobs**。确认原 run 的 source SHA 和 staging 目标。导出失败、密文过期或需要更新数据时重新 dispatch。
- 导出保留经过列审查的赛事与统计数据。Auth identity、真实邮箱、教育核验记录和核验引用、私有材料、审计、私人招募意向不导出。历史 DAK facts 保留不可用的配对 lineage，配对凭据 hash、权限与使用信息用固定的预览投影替换。资格赛历史保留格式、名额、状态、预排名和比赛关系。内部 actor 和裁决理由用预览占位值。公共资产经明确路径范围及 MIME/大小检查后导入固定 dev bucket。
- 独立比赛从 `0077_match_execution_context` 起镜像执行快照与结果结论。快照只投影固定 version、图池与脱敏双方（Preview A/B、空标志 URL），不复制任意 JSON 键；赛事比赛继续保留空快照。`result_disposition` 与总比分保持原值，保证导入后仍满足比赛变体和终局约束。旧 source migration prefix 不查询这两个新列。
- 社区奖只镜像公开状态的奖项；从 `0090_yellow_blink` 起保留人数/结奖政策、结果版本，以及已授奖奖项的完整获奖者关系。获奖者导出与同一快照中的 `awarded` 奖项关联，导入前再次校验该边界；尚未应用该 migration 的 source 不查询新表或新列。证据、核验记录、审核说明仍不导出。
- 个人纪律只镜像已生效、非草稿赛事中的公开记录（active / expired / revoked），保留公开说明、能力与生效窗口；`internal_evidence`、撤销内部理由与真实 actor 不导出，必填 `issued_by` 固定为 `preview:redacted`。导入前再次拒绝草稿、未来生效、草稿赛事、内部字段和未脱敏 actor。队伍裁决仍是独立事实，不转成成员处罚。
- 镜像不复制 Pick’Em 用户参与、预测单或积分。导入后的 schema 与当前代码一致（或显式应用当前 migrations）时，刷新流程通过 canonical `syncAutomaticPickEmInTx` 从开放赛事的官方名单幂等重建阶段窗口；截止与锁定仍按官方赛况判定。旧 source-only schema 跳过这一步，避免当前业务代码读取未来列。
- `preview_mirror_state` 只记录 source tag/commit、refresh 时间和计数，供 Preview banner 诊断；它不是 availability 状态机。
- refresh 先完成 dev Storage preflight，再 reset 并应用 snapshot source migrations。reset 同时移除本应用在 `realtime.messages` 上的 `rivalhub_match_live_receive` policy，由 active migration chain 重建，保留 provider 管理的表和其它 policies；随后，导入脱敏 production snapshot 并验证外键。手工 dispatch 可通过 `apply_current_migrations` 选择是否把 `migration_ref` 的当前 migration 应用到这份 production-derived 数据并再次验证，最后才 provision persona、公共 assets 与 mirror state。命令只输出固定的 phase 名称和完成/失败状态，不输出 row value、asset path、credential 或 provider 原始错误。共享 staging 上的 Preview 测试数据会被本次刷新覆盖。

从 `0106_vengeful_paibok` 起，`match_demo_imports.validated_revision` 随统计镜像保留。它是网站最近一次完整校验通过的比赛上下文 SHA-256，不是 credential 或原始身份材料；它与同次 snapshot 的统计投影 revision 一起保留，避免重检后的 Demo 在 Preview 中被错误回退到原始 `evidence_revision`。空值保持空值，继续由既有旧记录兼容逻辑解释；尚未应用该 migration 的 source 不查询或接受这个未来列。其余未知列、Auth identity、私有证据与生产运行状态仍按现有策略拒绝或排除。

## 离线消费者安全计量

计量输出为 best-effort：输出或 Step Summary 写入失败只尝试记录固定 `offline_consumer_accounting_unavailable` warning，不输出原始错误/路径，不把已完成的 artifact/read-back 或 snapshot 改判为失败。真实 dump、备份、read-back、export 或落盘错误仍遵循原失败门禁。

成功写入 snapshot 后，export owner 输出 `offline_consumer_summary` JSON/Step Summary。每张白名单表在现有单次查询返回后逐行累计 `rows` 与 `logical_payload_bytes`，只暂存单行 JSON 字符串；不增加查询、不复制整份 snapshot。该逻辑 bytes 是 **pg 已解码、SQL 已投影但尚未执行后续 JS 脱敏/URL 改写的每行 `JSON.stringify` UTF-8 字节之和**，不含数组分隔符、metadata 或 assets。它受驱动的 Date/number 转换及 JSON 转义影响，不是无损 canonical digest，也不是 PostgreSQL wire bytes。

`dump_file_bytes=null`；`snapshot_file_bytes` 是同次实际写入的 JSON 文件大小，包含最终脱敏结果、metadata 和 base64 assets；`storage_download_bytes` 在既有 asset download 流中累计真实 Buffer bytes，确认没有对象时为 `0`。`storage_objects` 同样区分未采集与空集。GitHub artifact 的压缩大小在导出阶段未知，`compressed_artifact_bytes=null`，不能拿 snapshot 文件大小代替。Recovery 的压缩加密制品口径见 [disaster recovery](./disaster-recovery.md#离线消费者安全计量)。

只有完成导出和落盘才输出 `exported`。加密和制品上传状态由 workflow 步骤另行记录。

摘要不包含业务行、Auth hash、asset path、credential 或 signed URL。logical/file/compressed/storage 数值互不替代，也不作为供应商 Egress 或线上节费证据。

## Source schema compatibility and diagnostics

Preview export 的 policy 以 source 的 Drizzle migration ledger 为输入，而不是无条件使用 latest `main` 的完整 table/column 清单。migration-keyed policy 只要求 source 已拥有的 table 与 exported column；source 尚未应用的 additive table/column 留在 future policy 中，不会被查询。reviewed-but-omitted column 不进入 export projection。Steam legacy shadow 由真实 cleanup migration 的 lifecycle marker 管理：source 尚未应用该 migration 时，Preview 允许这些物理列存在但不导出；migration 已应用后，若列重新出现则以 `REMOVED_MIRROR_COLUMNS` fail closed。source physical inventory 中的 unknown table/column、缺失 exported column 和不匹配的 migration prefix 仍 fail closed。

Export 与 refresh 的失败都经过现有 `src/lib/observability/` safe exception boundary，保留内部 `cause` chain，并输出稳定的 phase/code 与有限 structural context（例如 table、column、provider、providerCode、httpStatus、retryable）。允许的 export phase 包括 source identity、source DB connection、migration ledger、schema inventory-policy、table export、persona selection、public asset export 和 snapshot write；refresh phase 也会区分 snapshot read、DB、persona、asset 与 mirror-state 步骤。日志不会输出 production row、SQL/params、credential、provider body 或 asset path。

社区奖的 PostgreSQL integration 以当前真实 `information_schema` inventory 校验新增列与获奖者表，并执行公开获奖者导出查询。定向 policy 验证覆盖 `0090_yellow_blink` 前后的 source prefix、未知列拒绝和 artifact 中非公开获奖者拒绝；不把这些定向检查描述为全部历史 schema 的真实数据库验收。

生产的 `application_sessions`、`application_session_controls`、统计修复游标、BP 缓存投递进度 `match_veto_invalidations` 和计分恢复回执 `operator_scoreboard_receipts` 不进入脱敏镜像。后两者分别绑定生产缓存代次/事务与原操作人/请求编号，不能作为测试库的运行状态；目标迁移创建表结构，记录由 Preview 自身的 BP 与计分操作生成。`match_maps.provisional_players` 从 `0100_ambitious_switch` 起归为已审查但不导出的列，丢弃含玩家身份的未核对快照；`mizar_reliable_receipts` 整表继续排除，包括 `parent_event_key` 与 `map_end_scope`，不复制生产来源会话和事件关联。Preview persona 必须通过目标 Auth 重新登录，目标自行建立会话与维护进度。

## Preview 运行环境配置

服务器预览运行环境使用 dev-scoped 值：

- `DATABASE_URL`：`postgres.dtdzxnzjtohzjmfkighg` 的 Transaction Pooler URL（6543、`pgbouncer=true`）；
- `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 与 `SUPABASE_SECRET_KEY`：仅使用 `rivalhub-dev` 的现代 publishable/secret credential，不接受 legacy fallback；
- `SUPABASE_JWT_SECRET` 与 `SUPABASE_JWT_KID`：仅使用 `rivalhub-dev` 的签名密钥及其 ID，用于签发 5 分钟、单场、只读的 Realtime viewer token；不得使用 production signing secret；
- 独立 Preview `ADMIN_SESSION_SECRET`，以及仅用于 dev/sandbox 的邮件、OCR 或其它 provider credential。

Preview runtime 拒绝非 `rivalhub-dev` database/public Auth URL 与缺失的 server credential；production DB/Auth/Storage/provider credential 永远不得出现。预览站通过 HTTPS Basic Auth 控制访问；persona fixture credential 不是安全边界。正常的 dev 写入、Auth、Storage 和 sandbox provider 行为不受 Preview 专用限制；没有 sandbox provider credential 的单项能力应独立 fail closed。

## Preview persona fixture credentials

以下是 disposable Preview fixture credentials，供已经通过预览站 Basic Auth 的 developer/agent 直接进行角色态测试。它们不是安全 credential，也不应当用于 production 或其它不可牺牲环境；每次 refresh 都会把五个账号的密码重置为统一值。

统一密码：`rivalhub-preview-persona-resettable`

| Persona | Email |
| --- | --- |
| player | `preview-player@preview.invalid` |
| invited | `preview-invited@preview.invalid` |
| captain | `preview-captain@preview.invalid` |
| season-admin | `preview-season-admin@preview.invalid` |
| super-admin | `preview-super-admin@preview.invalid` |

## owner 一次性操作

1. 在 `rivalhub-dev` 的 Supabase Storage 确认 `team-logos` 为 public、1 MiB、且只允许 JPEG/PNG/WebP；`Refresh Preview Mirror` 会在 destructive DB reset 前对该固定 bucket 做幂等 bootstrap，provider 权限不足时必须先由 owner 补齐并 read back。
2. 在 GitHub `staging` environment 录入 `RIVALHUB_PREVIEW_DEV_SECRET_KEY` 与现有 `RIVALHUB_STAGING_DB_PASSWORD`；无需配置 persona password secret。
3. 用独立 `age-keygen` 生成 Preview identity。公钥写入 production Environment 的 `RIVALHUB_PREVIEW_AGE_RECIPIENT`，私钥写入 staging Environment 的 `RIVALHUB_PREVIEW_AGE_IDENTITY`。staging Environment 只允许从 `main` dispatch。灾备继续使用自己的离线密钥。
4. 在服务器 Preview 运行环境录入上述 dev-scoped 值，保留 HTTPS Basic Auth。
5. 从 `main` 手动运行 `Refresh Preview Mirror`，确认 source commit、加密与导入步骤结果，再做 Preview persona smoke。制品保留一天。
