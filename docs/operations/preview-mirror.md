# Preview 脱敏镜像运行手册

RivalHub 的 Vercel Preview 永远连接 `rivalhub-dev` 的生产派生脱敏镜像，不连接 production，也不读取 #569 的正式 R2 灾备 artifact。镜像由受保护的 `Refresh Preview Data` workflow 生成：production job 只读导出，staging job 在固定的 `cueazphyskstwdhnzsxx` 上迁移、重置和导入。

## 刷新边界

- 每日定时、手动 dispatch，以及 Release 成功后的 `workflow_run` 都进入同一个不可并行的 refresh concurrency。
- production job 只使用 production environment 的 `DATABASE_URL`/Supabase secret key；它不能写 production。
- staging job 只使用 staging environment 的 dev DB password、dev Supabase secret、persona password 和 `rivalhub_preview_ro` password；它不能读取 production credential。
- snapshot 只包含审查过的 public/domain projections。Auth identity、邮件、教育证据、邀请 token、审计和私有 bucket 不导出；公共 team logo 和显式 allowlist 的赛事公共 asset 才会镜像。
- `preview_mirror_state.ready=true` 只在迁移、导入、persona、asset 和 role verification 全部成功后写入。失败会保留 `ready=false`，页面不得把半成品当成可用数据。

## Vercel Preview 必须配置

Vercel Preview environment 只配置：

- `DATABASE_URL`：`rivalhub_preview_ro.<project-ref>` 的 Transaction Pooler URL（6543、`pgbouncer=true`）；
- `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`：`rivalhub-dev` public credential；
- `NEXT_PUBLIC_RIVALHUB_PREVIEW_READONLY=1`、`RIVALHUB_PREVIEW_MIRROR_MODE=production-derived`。

Preview 中不得存在 production `DATABASE_URL`、`SUPABASE_SECRET_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 或 production public URL。数据库 role 是第二道边界：`SELECT` 成功，DML、DDL、sequence 和 function `EXECUTE` 必须失败；应用 runtime 也会拒绝 mutation/provider 写路径。

## owner 一次性操作

1. 在 GitHub `staging` environment 设置 required reviewers、main-only deployment policy，并录入 `RIVALHUB_PREVIEW_DEV_SECRET_KEY`、`RIVALHUB_PREVIEW_PERSONA_PASSWORD`、`RIVALHUB_PREVIEW_RO_PASSWORD`。保留现有 `RIVALHUB_STAGING_DB_PASSWORD`。
2. 在 Vercel Preview environment 录入上面的四类变量，删除同名 production/旧 dev database 或 privileged key；保留 Deployment Protection。
3. 手动运行 `Refresh Preview Data`，确认 job summary 的 source commit、`ready=true`、SELECT-only role 和 page smoke 全部成功。不要把 snapshot 下载到个人设备或把 secret 写入 PR。

## planner

CI planner 输出 `preview_data_mode=mirror_compatible` 或 `non_production_like`。它只描述 changed surface 是否属于已审查的 presentation/docs 范围，不选择 credential，也不改变 Preview 的固定 mirror 数据源。fork、unknown、rename/delete、schema/auth/provider/CI surface 都 fail closed 为 `non_production_like`。
