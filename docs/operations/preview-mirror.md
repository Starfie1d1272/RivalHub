# Preview 脱敏镜像运行手册

RivalHub 的所有 Vercel Preview 固定连接 `rivalhub-dev`，不连接 production，也不读取 #569 的正式 R2 灾备 artifact。`rivalhub-dev` 是可牺牲 shared staging：Preview 可完整读写，下一次 refresh 覆盖测试数据。镜像由受保护的 `Refresh Preview Data` workflow 生成：production job 只读导出，dev job 在固定的 `dtdzxnzjtohzjmfkighg` 上重置和导入。

## 刷新边界

- 每日北京时间 11:17（UTC 03:17）刷新一次；Release 成功后仅当该次 Release Plan 包含数据库 migration 时额外刷新，纯应用发版不再重复全量导出。判断只读取 GitHub run 的 `preflight` / `Preview mirror migration marker` 步骤结果，不查询 production；恢复发布也使用冻结的 previous Production baseline 生成的同一 Release Plan。没有该标记的旧 Release 不触发额外刷新，仍可使用每日或手动刷新。API 读取失败会使 gate 失败，不执行导出；可在修复后重跑或按需手动触发。每日定时和满足上述条件的 `workflow_run` 固定使用 `main`；手动 dispatch 使用 `migration_ref` 选择 production snapshot export policy 与 dev refresh code，并要求它与 dispatch branch 一致，默认 `main`。这些运行都进入同一个不可并行的 refresh concurrency。
- 若 `export-production` 已成功而 `refresh-dev` 失败，在该 run 的 artifact 一天保留期内优先使用 GitHub Actions 的 **Re-run failed jobs**，复用同一 run 的脱敏 snapshot；先核对该 run 的 source commit 与本次要恢复的刷新一致。export 本身失败、artifact 已过期或需要新的 source snapshot 时，重新运行完整 workflow。
- production job 只使用 production environment 的 `DATABASE_URL`/Supabase secret key；它不能写 production。公共 asset allowlist 在这一 job 生效。
- dev job 只使用 staging environment 的 dev DB password 和 dev Supabase secret；persona password 是仓库定义的公开 fixture，不需要 secret provisioning。它不能读取 production credential。
- snapshot 只包含审查过的 public/domain projections。Auth identity、邮件、教育证据、邀请 token、审计、`recruitment_interests` 和 private bucket 不导出；公共 Team 招募 projection、team logo 与显式 allowlist 的赛事公共 asset 可以镜像。为支持赛事统计的真实 Preview 验收，DAK stats substrate（`dak_pairing_intents`、`dak_pairings`、`match_demo_imports`、`match_demo_stat_projections`、`match_round_facts`、`user_gameplay_steam_ids` 以及 `match_player_stats.dak_import_id`）也通过固定列清单镜像；其中只复制数据库内已有的 hash/provenance。统计投影的版本、来源 hash、比赛身份 binding 和可组合计数随同一只读 snapshot 导出，不为镜像额外重读 Evidence 或重新计算统计。source 尚未应用投影表 migration 时不查询该表；Preview 读取仍遵守当前投影版本，不因缺失投影回退到原始 payload。Qualification Preview 只镜像运行格式、名额、状态时间、批准 Entry 的预排名和 Qualification 比赛关联；真实 `updated_by`、`configured_by`、`started_by` actor ID 不导出；前两者以固定文本 `preview:redacted` 替代，`started_by` 仅在 `started_at` 非空时使用同一占位值，否则保持空值。这些字段是无用户外键的文本审计标识，不生成虚构用户或赋予 persona 权限；导入前拒绝缺失、真实 actor 或与开始状态不一致的值。赛事、Entry、entrant 和比赛引用仍保留并通过外键验证。非空的申诉与裁定 reason 使用固定“预览已脱敏”文本，原始私有原因不导出。Preview 仍不连接 production，也不获得原始 credential。Preview 固定使用 dev `team-logos` public bucket，其 contract 为 1 MiB、`image/jpeg`/`image/png`/`image/webp`；refresh 只对这个固定 bucket 做幂等的 get/create/update bootstrap，不复制 production bucket 配置或对象。
- 独立比赛从 `0077_match_execution_context` 起镜像执行快照与结果结论。快照只投影固定 version、图池与脱敏双方（Preview A/B、空标志 URL），不复制任意 JSON 键；赛事比赛继续保留空快照。`result_disposition` 与总比分保持原值，保证导入后仍满足比赛变体和终局约束。旧 source migration prefix 不查询这两个新列。
- 社区奖只镜像公开状态的奖项；从 `0090_yellow_blink` 起保留人数/结奖政策、结果版本，以及已授奖奖项的完整获奖者关系。获奖者导出与同一快照中的 `awarded` 奖项关联，导入前再次校验该边界；尚未应用该 migration 的 source 不查询新表或新列。证据、核验记录、审核说明仍不导出。
- 个人纪律只镜像已生效、非草稿赛事中的公开记录（active / expired / revoked），保留公开说明、能力与生效窗口；`internal_evidence`、撤销内部理由与真实 actor 不导出，必填 `issued_by` 固定为 `preview:redacted`。导入前再次拒绝草稿、未来生效、草稿赛事、内部字段和未脱敏 actor。队伍裁决仍是独立事实，不转成成员处罚。
- 镜像不复制 Pick’Em 用户参与、预测单或积分。导入后的 schema 与当前代码一致（或显式应用当前 migrations）时，刷新流程通过 canonical `syncAutomaticPickEmInTx` 从开放赛事的官方名单幂等重建阶段窗口；截止与锁定仍按官方赛况判定。旧 source-only schema 跳过这一步，避免当前业务代码读取未来列。
- `preview_mirror_state` 只记录 source tag/commit、refresh 时间和计数，供 Preview banner 诊断；它不是 availability 状态机。
- refresh 先完成 dev Storage preflight，再 reset 并应用 snapshot source migrations。reset 同时移除本应用在 `realtime.messages` 上的 `rivalhub_match_live_receive` policy，由 active migration chain 重建，保留 provider 管理的表和其它 policies；随后，导入脱敏 production snapshot 和验证外键；manual dispatch 可通过 `apply_current_migrations` 选择是否把 `migration_ref` 的当前 migration 应用到这份 production-derived 数据并再次验证，最后才 provision persona、公共 assets 与 mirror state。命令只输出固定的 phase 名称和完成/失败状态，不输出 row value、asset path、credential 或 provider 原始错误。旧 Preview 因共享 schema/data 失效是可接受的 trade-off；daily/post-release refresh 始终用 `main`。

## 离线消费者安全计量

计量输出为 best-effort：输出或 Step Summary 写入失败只尝试记录固定 `offline_consumer_accounting_unavailable` warning，不输出原始错误/路径，不把已完成的 artifact/read-back 或 snapshot 改判为失败。真实 dump、备份、read-back、export 或落盘错误仍遵循原失败门禁。

成功写入 snapshot 后，export owner 输出 `offline_consumer_summary` JSON/Step Summary。每张白名单表在现有单次查询返回后逐行累计 `rows` 与 `logical_payload_bytes`，只暂存单行 JSON 字符串；不增加查询、不复制整份 snapshot。该逻辑 bytes 是 **pg 已解码、SQL 已投影但尚未执行后续 JS 脱敏/URL 改写的每行 `JSON.stringify` UTF-8 字节之和**，不含数组分隔符、metadata 或 assets。它受驱动的 Date/number 转换及 JSON 转义影响，不是无损 canonical digest，也不是 PostgreSQL wire bytes。

`dump_file_bytes=null`；`snapshot_file_bytes` 是同次实际写入的 JSON 文件大小，包含最终脱敏结果、metadata 和 base64 assets；`storage_download_bytes` 在既有 asset download 流中累计真实 Buffer bytes，未配置下载能力时保留 `null`，实际成功检查且没有对象才是 `0`。`storage_objects` 同样区分未采集与空集。GitHub artifact 的压缩大小在导出阶段未知，`compressed_artifact_bytes=null`，不能拿 snapshot 文件大小代替。Recovery 的压缩加密制品口径见 [disaster recovery](./disaster-recovery.md#离线消费者安全计量)。

无 migration marker 的发布后刷新仍由不查询 production 的 policy job 决定；该分支输出 `status=skipped`，run/project/policy 开始结束时间可知，source release 与各数据计量为 `null`。这表示没有执行 export，不表示数据库为空；API 失败仍 fail closed，不转成成功 skip。daily/manual 与现有 migration marker 策略保持不变。只有完成导出/落盘才输出 `exported`，失败沿用安全 phase/code 报告，不能作为完成摘要统计。

摘要不包含业务行、Auth hash、asset path、credential 或 signed URL。logical/file/compressed/storage 数值互不替代，也不作为供应商 Egress 或线上节费证据。

## Source schema compatibility and diagnostics

Preview export 的 policy 以 source 的 Drizzle migration ledger 为输入，而不是无条件使用 latest `main` 的完整 table/column 清单。migration-keyed policy 只要求 source 已拥有的 table 与 exported column；source 尚未应用的 additive table/column 留在 future policy 中，不会被查询。reviewed-but-omitted column 不进入 export projection。Steam legacy shadow 由真实 cleanup migration 的 lifecycle marker 管理：source 尚未应用该 migration 时，Preview 允许这些物理列存在但不导出；migration 已应用后，若列重新出现则以 `REMOVED_MIRROR_COLUMNS` fail closed。source physical inventory 中的 unknown table/column、缺失 exported column 和不匹配的 migration prefix 仍 fail closed。

Export 与 refresh 的失败都经过现有 `src/lib/observability/` safe exception boundary，保留内部 `cause` chain，并输出稳定的 phase/code 与有限 structural context（例如 table、column、provider、providerCode、httpStatus、retryable）。允许的 export phase 包括 source identity、source DB connection、migration ledger、schema inventory-policy、table export、persona selection、public asset export 和 snapshot write；refresh phase 也会区分 snapshot read、DB、persona、asset 与 mirror-state 步骤。日志不会输出 production row、SQL/params、credential、provider body 或 asset path。

社区奖的 PostgreSQL integration 以当前真实 `information_schema` inventory 校验新增列与获奖者表，并执行公开获奖者导出查询。定向 policy 验证覆盖 `0090_yellow_blink` 前后的 source prefix、未知列拒绝和 artifact 中非公开获奖者拒绝；不把这些定向检查描述为全部历史 schema 的真实数据库验收。

生产的 `application_sessions`、`application_session_controls`、统计修复游标、BP 缓存投递进度 `match_veto_invalidations` 和计分恢复回执 `operator_scoreboard_receipts` 不进入脱敏镜像。后两者分别绑定生产缓存代次/事务与原操作人/请求编号，不能作为测试库的运行状态；目标迁移创建表结构，记录由 Preview 自身的 BP 与计分操作生成。`match_maps.provisional_players` 从 `0100_ambitious_switch` 起归为已审查但不导出的列，丢弃含玩家身份的未核对快照；`mizar_reliable_receipts` 整表继续排除，包括 `parent_event_key` 与 `map_end_scope`，不复制生产来源会话和事件关联。Preview persona 必须通过目标 Auth 重新登录，目标自行建立会话与维护进度。

## Vercel Preview 必须配置

Vercel Preview environment 只配置 dev-scoped 值：

- `DATABASE_URL`：`postgres.dtdzxnzjtohzjmfkighg` 的 Transaction Pooler URL（6543、`pgbouncer=true`）；
- `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 与 `SUPABASE_SECRET_KEY`：仅使用 `rivalhub-dev` 的现代 publishable/secret credential，不接受 legacy fallback；
- `SUPABASE_JWT_SECRET`：仅使用 `rivalhub-dev` 的 JWT signing secret，用于签发 5 分钟、单场、只读的 Realtime viewer token；不得使用 production signing secret；
- 独立 Preview `ADMIN_SESSION_SECRET`，以及仅用于 dev/sandbox 的邮件、OCR 或其它 provider credential。

Preview runtime 拒绝非 `rivalhub-dev` database/public Auth URL 与缺失的 server credential；production DB/Auth/Storage/provider credential 永远不得出现。Vercel Deployment Protection 仍是 Preview 的访问边界；persona fixture credential 不是安全边界。正常的 dev 写入、Auth、Storage 和 sandbox provider 行为不受 Preview 专用限制；没有 sandbox provider credential 的单项能力应独立 fail closed。

## Preview persona fixture credentials

以下是 disposable Preview fixture credentials，供已经通过 Vercel Deployment Protection 的 developer/agent 直接进行角色态测试。它们不是安全 credential，也不应当用于 production 或其它不可牺牲环境；每次 refresh 都会把五个账号的密码重置为统一值。

统一密码：`rivalhub-preview-persona-resettable`

| Persona | Email |
| --- | --- |
| player | `preview-player@preview.invalid` |
| invited | `preview-invited@preview.invalid` |
| captain | `preview-captain@preview.invalid` |
| season-admin | `preview-season-admin@preview.invalid` |
| super-admin | `preview-super-admin@preview.invalid` |

## owner 一次性操作

1. 在 `rivalhub-dev` 的 Supabase Storage 确认 `team-logos` 为 public、1 MiB、且只允许 JPEG/PNG/WebP；`Refresh Preview Data` 会在 destructive DB reset 前对该固定 bucket 做幂等 bootstrap，provider 权限不足时必须先由 owner 补齐并 read back。
2. 在 GitHub `staging` environment 录入 `RIVALHUB_PREVIEW_DEV_SECRET_KEY` 与现有 `RIVALHUB_STAGING_DB_PASSWORD`；无需配置 persona password secret。
3. 在 Vercel Preview environment 录入上述 dev-scoped 值，删除任何 production 或身份不明的同名值；保留 Deployment Protection。
4. 手动运行 `Refresh Preview Data`，确认 job summary 的 source commit、各 phase 结果和页面 smoke。artifact 保留一天，且不得下载到个人设备或把 secret 写入 PR。
