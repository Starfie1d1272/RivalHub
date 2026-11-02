# 独立实例安装（F1）

本入口面向一个组织、一台 Linux x64 主机、一个 Node 进程和一个全新 Hosted Supabase 项目。它不接管现有项目或官方 Production/Preview；完整自托管 Supabase 尚未验收。安装不会创建账号、密钥、DNS、证书或 Supabase 项目。操作员需要有目标项目的管理权限，并自行保管凭据。切换应用不回滚数据库；升级前应先评估迁移兼容性并准备该实例可恢复的备份。

## 准备

使用干净、已提交的同一源码版本与 lockfile 安装依赖。构建机需要仓库声明的 Node/pnpm；构件包含构建机的 Node 二进制，目标机须兼容其系统库（包括 glibc），应使用兼容的构建和目标系统并在目标机验证。目标机首次组装需要 Node 24、systemd、Caddy、curl、tar、flock 和 sha256sum。目标机必须是专用实例，安装目录 `/opt/rivalhub-instance`、配置 `/etc/rivalhub-instance/instance.env` 和端口 3033 不应被其他服务占用。主机上保留同一版本的源码工具（包括 `scripts/standby` 与 `src/db`），用于安装与数据库排空。

在新 Supabase 项目启用 pg_cron、pg_net、Vault 和 Realtime，并确保 cron 时区为 UTC。配置 Auth 的站点 URL、允许的回调 URL、邮件服务及 `supabase/templates/` 中的邮件模板；邮件重发间隔与实例配置中的值一致。确认项目的 Storage 和 Auth 服务可用，使用项目 Realtime 接受的 HS256 JWT signing secret；有 key id 时同时设置 `SUPABASE_JWT_KID`。不要改写 Supabase 内部 Auth/Storage schema 或其迁移账本；active Drizzle 链负责应用所需 bucket、策略和 publication。应用首管通过 `RIVALHUB_OWNER_EMAIL` 对应用户首次正常认证时的事务锁选出，不设置第二个管理员密码。

复制 `scripts/instance/instance.env.example` 到仅 root 可读的位置并填写独立项目的 API、数据库、密钥、应用 HTTPS origin 和首管邮箱，设置权限 0600。确保数据库连接和 API 是同一个项目；无需将该文件放入构件。样例是占位符，不能直接用于服务。系统使用已有 Supabase PostgreSQL TLS contract，远程连接只支持 Hosted Supabase 域名。

## 首次数据库供给

在与应用同版本的源码目录，以单独受保护的环境加载实例 env，并显式设置 `RIVALHUB_INSTANCE_PROJECT_REF` 与相同的 `RIVALHUB_INSTANCE_CONFIRM` 为项目 ref。命令会修改明确指定的项目，务必先核实目标；项目必须是空的专用 Supabase 项目：

```bash
RIVALHUB_INSTANCE_WRITE=yes pnpm exec tsx scripts/instance/provision.ts install
```

`install` 只接受没有应用对象、Drizzle 账本、Auth 用户及 Storage 对象的全新目标，调用现有 active migration runner；供给时将同一项目和凭据的 transaction pooler 连接切换到 session pooler 5432，以保证会话锁与迁移连接稳定。迁移会验证 `team-logos` 的公开图片合同；已有 bucket 配置不符时拒绝，不改变其权限。泛用实例不默认启用官方学校邮箱自动认证：旧链在全新库种入的官方域名规则仅在精确匹配预期时移除，其他规则不猜测修改。已有实例不得调用此入口；中途失败后不自动接管或清空目标。主机首次安装在启动服务前检查完整账本、team-logos 合同与官方邮箱种子已清理；检查失败不会启动候选。后续同机升级须保持 Supabase 项目及数据库名称一致；允许同一数据库在直连和连接池之间切换以及凭据轮换。升级保留并允许现有邮箱规则，服务每次启动仍校验账本和 bucket。更换主机时，本机无旧版本不能证明数据库是全新目标；已有库的恢复接入须等待 F2 的备份及实例身份合同。

## 构建与安装

```bash
pnpm install --frozen-lockfile
node scripts/instance/build.mjs
```

输出位于 `.agent-tmp/instance-package/`：manifest、校验和和三个内容寻址层。构建不读取本地 env、项目域名或运行密钥；请通过可信渠道把整个目录和对应源码工具送到主机。主机执行（把路径替换为实际值）：

```bash
sudo bash scripts/instance/install.sh /path/to/manifest.layers.json /path/to/instance.env
```

安装验证 manifest 与各层、组装独立目录，停服务并确认数据库事务排空，原子切换 current，检查首页、release identity 和数据库活跃链账本；候选失败会排空后恢复前一版本及配置。排空失败保持停机供检查。安装不会运行迁移；当前构件要求数据库账本与构件所含 active chain 完全一致，升级迁移等价由 F2 确定。首次安装后按 `scripts/instance/Caddyfile.example` 配置自己的域名及 TLS，验证反向代理；不要把示例域名当成实际站点。应用、构件与密钥分开保存。

## 备份与恢复边界

独立实例 full backup 使用既有 `db:recovery:backup`，显式设置 `RIVALHUB_BACKUP_SOURCE=instance`、非官方 `RIVALHUB_INSTANCE_PROJECT_REF` 与相同的 `RIVALHUB_INSTANCE_CONFIRM`，并提供该实例的应用 origin、API、Session Pooler 数据库连接、Storage secret key、age recipient 与独立 R2 配置。运行中的实例必须提供 `/api/system/recovery-source`：它只返回 release 和已公开的项目身份，备份会核对其实际运行配置、Git tag/commit、数据库项目以及采集前后的账本。旧版本不支持此合同，不能靠手填身份替代。实例 artifact 位于 `instance/<project-ref>/`，该前缀的保留策略由实例运营者配置；官方 `production/` 策略不自动覆盖它。

仅 full artifact 可以申请恢复证据。恢复到新的非官方 Hosted 项目时，显式设置 `RIVALHUB_RECOVERY_TARGET=instance`、`RIVALHUB_INSTANCE_WRITE=yes`、目标项目 ref 和确认值，以及目标 `RIVALHUB_RECOVERY_DATABASE_URL`、`RIVALHUB_RECOVERY_SUPABASE_URL`、`RIVALHUB_RECOVERY_PUBLISHABLE_KEY`、`RIVALHUB_RECOVERY_SERVICE_ROLE_KEY`。使用原有 `db:recovery:fetch` 和 `db:recovery:restore`，后者接受 `--evidence-directory` 指向恢复操作员拥有且权限为 0700 的目录。只有 artifact、数据、生命周期、Storage 和账本均验证通过后才生成权限 0600 的证据；DB-only checkpoint 不可生成证据。Hosted provider 的所需恢复权限尚未实机验证，权限拒绝必须停止处理。

新主机安装可向 `install.sh` 传 `--recovery-evidence` 和上述文件。安装前会核查受保护文件、恢复的真实目标、完整账本以及与备份相同的 release；然后再次读取实际数据库的账本和 bucket。无证据仍执行 fresh-only 检查。同机升级与后续应用切换仍须遵循现有 release 能力合同，恢复证据不自动授权跨版本升级。文件 checksum 和受保护目录提供一致性及运营者信任边界，并非备份来源的数字签名。

## Scheduler

应用可经公开 HTTPS 地址访问后，在与首次供给相同的受保护环境中运行：

```bash
RIVALHUB_INSTANCE_WRITE=yes pnpm exec tsx scripts/instance/provision.ts scheduler
pnpm exec tsx scripts/instance/provision.ts verify-scheduler
```

`scheduler` 使用同一现有 job registry、Vault 命名与 HTTP dispatch；`verify-scheduler` 触发实际 dispatch，需要可访问的应用和匹配的 `CRON_SECRET`。这些工具不配置 Supabase 内部服务。对已有实例的迁移、adopt、新基线和 restore 等价由 F2 收敛；不要对其使用首次安装入口或改写历史账本。

## 验收边界

隔离 Local Supabase 已真实回放当前活跃迁移链，验证 Auth、Storage 对象生命周期、Data API 默认拒绝、scheduler dispatch 写入和 private Realtime 的订阅、跨比赛及写入拒绝；构件 readiness 对真实本地账本通过，对不匹配账本拒绝。安装脚本的临时目录演练验证了候选重启失败后的指针和配置恢复，以及排空失败时保持原指针与配置；演练中的 systemctl、HTTP、排空和 readiness 使用替身。

这些证据不构成 Hosted Supabase、session pooler、实际 systemd/Caddy 主机或完整自托管组合的验收，也不证明生产容量。真实项目仍需验证首次供给、公开 HTTPS、注册/邮件、首管、Storage、Realtime 与 scheduler；不能以替身结果代替实机验收。
