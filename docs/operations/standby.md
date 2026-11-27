# Linux 应用托管

本手册管理官方实例的 Linux 应用托管。Production 使用正式域名与独立生产服务（`47.103.131.158`）；Preview 备用机已下线，相关打包与安装流程已退役。Supabase 继续提供数据库、Auth、Storage 和 Realtime。实际在线版本以正式 `/api/system/release` 回读为准；首次生产切换及验收缺口见 [2026-10-23 执行记录](../archive/rehearsals/2026-10-23-linux-hosting-cutover.md)。

## 应用日志容量与只读量测

Linux 应用默认将结构化 stdout/stderr 交给主机 journal。`scripts/standby/log-capacity.py` 只读输出 JSON：根分区容量、日志/应用目录已分配字节，以及最近两个完整 24 小时窗口的日志正文计数与字节聚合。它跨 default 与独立 journal namespace 读取；仅输出固定服务分类，其他来源合并为 other，不输出 message、账号、地址或日志原文。需要 Linux、Python 3、GNU du 与支持 namespace 的 systemd；以 root 运行才能覆盖全部可读日志。命令失败、权限不足、每窗口 60 秒超时或 200,000 条上限会限制结果；available=false/possiblyTruncated=true 时不能当作完整用量。

```bash
python3 scripts/standby/log-capacity.py
# 从操作员 checkout 直接送入已核实主机执行；不安装 agent 或定时任务
ssh -p 52222 47.103.131.158 'python3 -' < scripts/standby/log-capacity.py
```

日志正文大小不包含 journal 索引、元数据和压缩开销，不能当作磁盘增长。比赛前后分别保存这份脱敏快照，比较实际目录占用、正文量与根分区余量；轮转删除、其它服务和应用包也会改变磁盘值。此工具不清理、不导出原始日志，也不创建历史数据库。

应用专用容量策略由 `scripts/standby/journal/` 模板拥有，通过 `configure-journal.sh` 在已安装的主机上独立 opt-in；正式/Preview 安装器与 Release 不自动启用。要求 systemd >=245 与 journal namespace 支持。两个应用可共用 rivalhub namespace：持久日志容量目标 256MiB、单文件 16MiB、保留目标七天、磁盘可用空间目标 2GiB；运行时日志目标 16MiB，关闭该 namespace 的 syslog/kmsg/console/wall 转发。容量约束可能使日志早于七天淘汰；journal 按文件轮转和删除，活跃文件与文件粒度可能使容量/时限暂时超出目标，不能承诺精确七天物理删除。这项设置只管理启用后该 namespace 的日志，不清理既有全机 journal 或其它服务文件。

```bash
# 在已获授权的配置窗口，复制脚本与相邻 journal/ 模板后执行
bash scripts/standby/configure-journal.sh --check rivalhub-production
bash scripts/standby/configure-journal.sh --apply rivalhub-production
# Preview 如需同一策略，单独选中；两者共享上述容量
bash scripts/standby/configure-journal.sh --apply rivalhub-standby
```

工具只接受这两个服务，拒绝覆盖内容不同的现有配置。`--apply` 安装 namespace 配置与应用独立 systemd drop-in 并 daemon-reload，保留应用/日志进程；随后在下一次已授权的发布或维护重启时启用新的 stdout/stderr 路由，namespace 会按 systemd 依赖启动。它增加一个专用 journald 实例，启用后应量测其内存。应用包更新与 rollback 只替换基础 service，保留主机 drop-in，因此两条路径使用相同日志策略。读取新日志时指定 namespace；全机默认 journal 中的旧日志继续按原策略保留：

```bash
journalctl --namespace=rivalhub -u rivalhub-production --since '10 minutes ago'
journalctl --namespace=rivalhub --disk-usage
systemctl show rivalhub-production -p LogNamespace -p MainPID
```

`systemctl show` 只证明加载的配置；重启后还须通过新 namespace 实际读回结构化应用事件，才能完成启用验收。恢复默认路由时，在维护窗口移除对应应用的 `50-rivalhub-journal.conf` drop-in、daemon-reload，并重启该应用；保留 namespace 配置与旧日志供到期轮转，不执行 vacuum 或目录删除。主机日志不属于数据库/Storage DR 备份；独立配置应随主机配置备份保存，恢复时复核 namespace 与查询入口，遥测 D1 的保留策略不受影响。

依据：[systemd journal namespaces](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#LogNamespace=)、[journald 容量与轮转](https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html#SystemMaxUse=)。

## Production 打包与安装

正式 Production 通过 [Release workflow](./release.md#3-protected-release-workflow) 调用 `build-production.mjs` 构建 Linux x64 standalone 包；`production_public_configuration` 是从实际 Production 核实的公开配置 JSON，仅接受 `production-config.mjs` 声明的键。不要放入数据库、会话或 provider secret。

构建器在独立 worktree 检出正式 tag，验证 clean source、package version、main ancestry 与 exact-SHA canonical CI，再通过原 release build entrypoint 构建 Linux x64 standalone。构建仅继承公开 allowlist，禁用本地 `.env` 加载，凭据不进入构建环境。包记录应用 SHA、operator tooling SHA、public configuration SHA-256、Node 版本和 CI run；archive sidecar 记录整体 SHA-256。构建工具的提交与应用提交分开记录，新增部署工具不改变应用 release identity。

1. 从对应 Release workflow run 核对构建产物、JSON manifest 和 `.sha256`，交叉核对正式 release 与构建配置。
2. 从既有受保护 Production 配置准备独立 runtime 文件。凭据从现有 secret store 取得；禁止用旧导出或新随机值静默替换 session/cron/provider 凭据。必需项为 `DATABASE_URL`、`SUPABASE_SECRET_KEY`、`SUPABASE_JWT_SECRET`、`ADMIN_SESSION_SECRET`、`CRON_SECRET`；启用的 Turnstile、Steam、OCR、observability 和 telemetry 配置保持原值。全部公开变量须与包一致。
3. runtime 明确设置 `NODE_ENV=production`、`VERCEL_ENV=production`、`RIVALHUB_DB_TARGET=production`、`HOSTNAME=127.0.0.1`、`PORT=3032`、`NODE_OPTIONS=--max-old-space-size=320`；`GIT_COMMIT_SHA`、`RIVALHUB_RELEASE_COMMIT` 和 `RIVALHUB_RELEASE_TAG` 与包 manifest 对齐，供日志和产品统计标记来源；禁止测试认证开关。凭据文件权限 600，目录 700。已交付的 Linux runtime 副本保存在操作员本机 `~/.config/rivalhub/credentials/production-linux.env`；更新须同步受保护副本，禁止提交或打印。
4. 传输包、checksum、runtime 文件及同一 operator commit 的 `install-production.sh`、`production-host.mjs` 与 `rivalhub-production.service`，运行 `bash install-production.sh ARCHIVE PRODUCTION_ENV`。安装器先校验包和实际 runtime target，再切换应用；不执行 migration。systemd 用户 `rivalhub-production`、服务 `rivalhub-production`、目录 `/opt/rivalhub-production`、配置 `/etc/rivalhub-production/production.env` 与 Preview 分离。服务只监听 loopback；内存上限 512 MiB，写权限限于 `.next/cache` 与 `.next/server/route-cache`；安装器预建并赋予应用用户这两个运行时缓存目录的写权限，构建代码保持只读。
5. 更新前快照保存在 `/opt/rivalhub-production/rollback/<timestamp>`，包含 previous symlink、环境和 service；身份检查失败触发回退。首次失败保持服务停止。必须另行回读业务和 TLS，安装器的身份检查不代表业务验收完成。

回退已有生产候选时先停止服务，按 `previous-snapshot` 指定的快照恢复 `previous-release` symlink、`production.env` 与 `service`，执行 `daemon-reload` 和启动，并回读 exact release identity。缺少任一快照项时停止并定位；保留当前、上一包及故障证据。反向代理与 DNS 是独立回退步骤。

正式域名的 Caddy site 使用有效证书，参见 [`Caddyfile.production.example`](../../scripts/standby/Caddyfile.production.example)。`reverse_proxy 127.0.0.1:3032` 默认保留 Host，并设置 X-Forwarded-Host、X-Forwarded-Proto；保持 streaming。应用发送 HTTPS 主站 HSTS、内容类型与 Referrer 策略，并禁止首页、登录和私有工作区被 iframe 嵌入。公开比赛与 Mizar 路径保持可嵌入。代理请求体上限设为 12 MB，为 Next 的 10 MiB Server Actions 及 multipart 开销留出空间；应用层限制仍生效。不要设置全站共享 HTML 缓存或 Preview Basic Auth。切换前用 DNS challenge 预置有效证书，并用 `curl --resolve` 或显式 SNI/Host 的 HTTPS 客户端验证；切换后去除临时静态证书引用，确认 Caddy 自动签证成功并登记 renewal 信息。保留预置证书作为故障证据，不能把手工 DNS 证书视为自动续期已完成。

新旧 standalone build 的 Server Actions ID/encryption key 可能不同。验收需在候选上重新加载页面并实际调用 action；旧页面可能需要刷新。Session 延续仍取决于相同的 `ADMIN_SESSION_SECRET`，不能以应用 commit 相同推断密钥或 action identity 相同。

## 公共缓存与验收

现有 `use cache: remote` 的公共 read model 保留原有 TTL/tag 失效边界；当前 Next.js 内置实现在自托管未配置 remote handler 时使用进程内 handler。单进程可复用缓存，重启后重新预热。正式站与预览站各有独立缓存，跨实例写入不传播内存 tag 失效，另一实例按原 TTL 刷新；因此验收更新时必须在同一实例验证。以后增加多副本时，需要共享 cache handler 或失效广播，并单独验证。

Preview 先验证 401 访问保护；Production 验证公开入口可访问。随后依次验证 HTTPS release identity、首页和赛事、真实登录与会话、角色权限、可恢复写入及刷新回读、静态资源/图片、重启恢复。生产验证不得操作真实赛果或竞猜。竞猜只做读路径验收时，不得声称已验证下单、结算或资金一致性。Realtime 订阅成功只证明接收通道，Mizar 实际设备配对和事件推送仍需独立验收。账号不可用而由 owner 明确接受延后登录时，记录该验收缺口和接手人。

运行日志从服务 journal 核对，应用不配置外部日志/trace exporter。产品统计密钥轮换同时更新 Worker `SIGNING_KEY` 与应用 `PRODUCT_TELEMETRY_SIGNING_KEY`；`PRODUCT_TELEMETRY_ACCOUNT_KEY` 轮换会改变账号匿名标识，须按当次授权执行。Worker 的查询凭据、保留策略和清理任务保持原配置。

生产服务在自己的 `StateDirectory` 下保留可重建的阵容历史总体。目录跨进程重启和 release 切换复用，由 systemd 创建并限制为服务用户访问。缓存损坏或缺失会按当前数据库版本回填。

## Production 更新

正式更新使用 [Release workflow](./release.md#3-protected-release-workflow) 的 Linux 路径，保持 migration、checkpoint 与 exact-SHA CI 门槛。构建公开配置写入 production Environment 的 `RIVALHUB_PRODUCTION_PUBLIC_CONFIGURATION`；`LINUX_DEPLOY_SSH_KEY` 为专用部署私钥，`LINUX_DEPLOY_KNOWN_HOSTS` 固定已验证主机公钥。SSH root 部署权限须经 owner 授权后建立，禁止把个人 SSH key 上传到 GitHub。安装采用单实例短暂停机切换，公网 canonical 检查失败也会回退上一包；制品、快照及 SSH 事务目录保留作恢复证据。

### 单进程在线人数

正式 `start-production.mjs` 在启动 standalone server 前设置进程内部 `RIVALHUB_PRESENCE_MODE=single-process`，服务由单个 Node PID 承载时使用共享进程内存计数。该标志不进入公开构建配置，也不从浏览器接受；不得将本 launcher 包装成多 worker/多副本后继续沿用该模式。其它启动入口保留 PostgreSQL fallback。状态重启清空，后续可见页面心跳自动恢复；详细统计与持久检查点语义见 [在线活跃状态](../auth-and-permissions.md#在线活跃状态)。
