# Preview 脱敏镜像运行手册

RivalHub 的所有 Vercel Preview 固定连接 `rivalhub-dev`，不连接 production，也不读取 #569 的正式 R2 灾备 artifact。`rivalhub-dev` 是可牺牲 shared staging：Preview 可完整读写，下一次 refresh 覆盖测试数据。镜像由受保护的 `Refresh Preview Data` workflow 生成：production job 只读导出，dev job 在固定的 `cueazphyskstwdhnzsxx` 上重置和导入。

## 刷新边界

- 每日定时、手动 dispatch，以及 Release 成功后的 `workflow_run` 都进入同一个不可并行的 refresh concurrency。
- production job 只使用 production environment 的 `DATABASE_URL`/Supabase secret key；它不能写 production。公共 asset allowlist 在这一 job 生效。
- dev job 只使用 staging environment 的 dev DB password、dev Supabase secret 和 persona password；它不能读取 production credential。
- snapshot 只包含审查过的 public/domain projections。Auth identity、邮件、教育证据、邀请 token、审计、`recruitment_interests` 和 private bucket 不导出；公共 Team 招募 projection、team logo 与显式 allowlist 的赛事公共 asset 可以镜像。
- `preview_mirror_state` 只记录 source tag/commit、refresh 时间和计数，供 Preview banner 诊断；它不是 availability 状态机。
- refresh 先 reset 并应用 snapshot source migrations，再导入脱敏 production snapshot 和验证外键；manual dispatch 可随后把指定 ref 的当前 migration 应用到这份 production-derived 数据并再次验证，最后才 provision persona、公共 assets 与 mirror state。旧 Preview 因共享 schema/data 失效是可接受的 trade-off；daily/post-release refresh 始终用 `main`。

## Vercel Preview 必须配置

Vercel Preview environment 只配置 dev-scoped 值：

- `DATABASE_URL`：`postgres.cueazphyskstwdhnzsxx` 的 Transaction Pooler URL（6543、`pgbouncer=true`）；
- `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` 与 `SUPABASE_SERVICE_ROLE_KEY`：`rivalhub-dev` credential；
- 独立 Preview `ADMIN_SESSION_SECRET`，以及仅用于 dev/sandbox 的邮件、OCR 或其它 provider credential。

Preview runtime 拒绝非 `rivalhub-dev` database/public Auth URL 与缺失的 server credential；production DB/Auth/Storage/provider credential 永远不得出现。正常的 dev 写入、Auth、Storage 和 sandbox provider 行为不受 Preview 专用限制；没有 sandbox provider credential 的单项能力应独立 fail closed。

## owner 一次性操作

1. 在 GitHub `staging` environment 录入 `RIVALHUB_PREVIEW_DEV_SECRET_KEY`、`RIVALHUB_PREVIEW_PERSONA_PASSWORD` 与现有 `RIVALHUB_STAGING_DB_PASSWORD`。
2. 在 Vercel Preview environment 录入上述 dev-scoped 值，删除任何 production 或身份不明的同名值；保留 Deployment Protection。
3. 手动运行 `Refresh Preview Data`，确认 job summary 的 source commit 和页面 smoke。artifact 保留一天，且不得下载到个人设备或把 secret 写入 PR。
