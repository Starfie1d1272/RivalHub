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

`install` 只接受没有应用对象及 Drizzle 账本的全新目标，调用现有 active migration runner；供给时将同一项目和凭据的 transaction pooler 连接切换到 session pooler 5432，以保证会话锁与迁移连接稳定。中途失败后不自动接管或清空目标。

## 构建与安装

```bash
pnpm install --frozen-lockfile
node scripts/instance/build.mjs
```

输出位于 `.agent-tmp/instance-package/`：manifest、校验和和三个内容寻址层。构建不读取本地 env、项目域名或运行密钥；请通过可信渠道把整个目录和对应源码工具送到主机。主机执行（把路径替换为实际值）：

```bash
sudo bash scripts/instance/install.sh /path/to/manifest.layers.json /path/to/instance.env
```

安装验证 manifest 与各层、组装独立目录，停服务并确认数据库事务排空，原子切换 current，检查首页、release identity 和数据库活跃链账本；候选失败会排空后恢复前一版本及配置。排空失败保持停机供检查。首次安装后按 `scripts/instance/Caddyfile.example` 配置自己的域名及 TLS，验证反向代理；不要把示例域名当成实际站点。应用、构件与密钥分开保存。

## 应用升级与回滚

对于数据库账本与新旧构件均完全一致的应用升级，在目标机使用与候选构件 operator commit 一致的干净源码目录运行：

```bash
sudo pnpm exec tsx scripts/instance/release.ts /path/to/manifest.layers.json /etc/rivalhub-instance/instance.env
```

controller 从运行中实例读取真实 release identity，从不可变 Git commit 读取前后能力合同，并生成与正式 release 共用格式的受限证据。安装器在切换及补偿回滚前复验合同，将身份和证据保存在 root-only 事务快照。若需显式恢复上一事务，在同一 operator 源码目录运行：

```bash
sudo pnpm exec tsx scripts/instance/release.ts --rollback
```

安装器不会运行数据库迁移；readiness 仍要求数据库账本与所运行构件完全一致。涉及迁移的升级与跨账本回滚尚未开放，不能以应用回滚作为数据库回滚。

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
