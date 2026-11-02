# 独立实例安装（F1）

本入口面向一个组织、一台 Linux x64 主机、一个 Node 进程和一个全新 Hosted Supabase 项目。它不接管现有项目或官方 Production/Preview；安装器当前只接受 Hosted Supabase 项目域名与项目密钥；完整自托管 Supabase 不受当前安装路径支持，也未验收。安装不会创建账号、密钥、DNS、证书或 Supabase 项目。操作员需要有目标项目的管理权限，并自行保管凭据。切换应用不回滚数据库；升级前应先评估迁移兼容性并准备该实例可恢复的备份。

## 准备

使用干净、已提交的同一源码版本与 lockfile 安装依赖。构建机需要仓库声明的 Node/pnpm；构件包含构建机的 Node 二进制，目标机须兼容其系统库（包括 glibc），应使用兼容的构建和目标系统并在目标机验证。目标机首次组装需要 Node 24、systemd、Caddy、curl、tar、flock 和 sha256sum。目标机必须是专用实例，安装目录 `/opt/rivalhub-instance`、配置 `/etc/rivalhub-instance/instance.env` 和端口 3033 不应被其他服务占用。主机上保留同一版本的源码工具（包括 `scripts/standby` 与 `src/db`），用于安装与数据库排空。

在新 Supabase 项目启用 pg_cron、pg_net、Vault 和 Realtime，并确保 cron 时区为 UTC。配置 Auth 的站点 URL、允许的回调 URL、邮件服务及 `supabase/templates/` 中的邮件模板；邮件重发间隔与实例配置中的值一致。确认项目的 Storage 和 Auth 服务可用，使用项目 Realtime 接受的 HS256 JWT signing secret；有 key id 时同时设置 `SUPABASE_JWT_KID`。不要改写 Supabase 内部 Auth/Storage schema 或其迁移账本；active Drizzle 链负责应用所需 bucket、策略和 publication。应用首管通过 `RIVALHUB_OWNER_EMAIL` 对应用户首次正常认证时的事务锁选出，不设置第二个管理员密码。

复制 `scripts/instance/instance.env.example` 到仅 root 可读的位置并填写独立项目的 API、数据库、密钥、应用 HTTPS origin 和首管邮箱，设置权限 0600。确保数据库连接和 API 是同一个项目；无需将该文件放入构件。样例是占位符，不能直接用于服务。系统使用已有 Supabase PostgreSQL TLS contract，远程连接只支持 Hosted Supabase 域名。

## 首次数据库供给

在与应用同版本的源码目录，以单独受保护的环境加载实例 env，并显式设置 `RIVALHUB_INSTANCE_PROJECT_REF` 与相同的 `RIVALHUB_INSTANCE_CONFIRM` 为项目 ref。命令会修改明确指定的项目，务必先核实目标；项目必须是空的专用 Supabase 项目：

```bash
RIVALHUB_INSTANCE_WRITE=yes pnpm exec tsx scripts/instance/provision.ts install
```

`install` 只接受没有应用对象、Drizzle 账本、Auth 用户及 Storage 对象的全新目标，调用现有 active migration runner；供给时将同一项目和凭据的 transaction pooler 连接切换到 session pooler 5432，以保证会话锁与迁移连接稳定。迁移会验证 `team-logos` 的公开图片合同；已有 bucket 配置不符时拒绝，不改变其权限。泛用实例不默认启用官方学校邮箱自动认证：v3 基线直接不写入官方域名规则；已有实例的规则由升级和恢复保留。已有实例不得调用此入口；中途失败后不自动接管或清空目标。主机首次安装在启动服务前检查完整账本、team-logos 合同与官方邮箱种子已清理；检查失败不会启动候选。后续同机升级须保持 Supabase 项目及数据库名称一致；允许同一数据库在直连和连接池之间切换以及凭据轮换。升级保留并允许现有邮箱规则，服务每次启动仍校验账本和 bucket。更换主机时，本机无旧版本不能证明数据库是全新目标；已有库的恢复接入须使用备份及实例身份合同。

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

在目标机使用与候选构件 operator commit 一致的干净源码目录运行：

```bash
sudo pnpm exec tsx scripts/instance/release.ts /path/to/manifest.layers.json /path/to/candidate-instance.env
```

候选环境文件必须独立于已安装的 `/etc/rivalhub-instance/instance.env`；不要先修改已安装文件。安装器从运行中的 `/api/system/recovery-source` 核对 release、项目和数据库与旧配置一致，并在停服务前再次核对。旧版本没有此接口时不能以手填信息代替。controller 从运行中实例读取真实 release identity，从不可变 Git commit 读取前后能力合同，并生成与正式 release 共用格式的受限证据。安装器在切换及补偿回滚前复验合同，将身份和证据保存在 root-only 事务快照。若需显式恢复上一事务，在同一 operator 源码目录运行：

```bash
sudo pnpm exec tsx scripts/instance/release.ts --rollback
```

迁移变更还须以 `--checkpoint-env /path/to/checkpoint.env` 指定 root 拥有、权限 0600 且位于 root 拥有的 0700 目录中的独立文件，提供 `RIVALHUB_INSTANCE_PROJECT_REF`、相同的 `RIVALHUB_INSTANCE_CONFIRM`、`RIVALHUB_BACKUP_AGE_RECIPIENT` 与实例专用 R2 配置；该文件也须提供 `SUPABASE_SECRET_KEY`。数据库及 API 配置使用已安装实例的环境。操作前确保该实例的备份可恢复，且没有其他数据库写入者或迁移执行者。安装器在锁内读取运行实例的身份和精确旧账本，停止服务并排空后复核，再创建加密 DB checkpoint 并验证 R2 读回。随后只接受已审核 active 链或旧链的精确前缀，通过现有迁移执行器补齐旧链、核验物理合同并接管 baseline，再执行新链，最后检查候选 readiness。

迁移开始前失败可恢复旧程序；迁移开始后失败保持服务停止和事务快照，不自动启动旧程序。必须先按现有恢复流程在隔离目标恢复并验证 checkpoint，才能考虑运行与该数据库匹配的旧程序；应用回滚不回滚数据库。当前 DB-only 恢复入口仅支持隔离目标，Hosted 目标的恢复与重新接入尚未验收。checkpoint 的记录保存在 root-only 事务快照中。

恢复检查点时，保持实例及其他写入者停止。从事务快照的 `checkpoint.log` 取 `completion=` 后的对象 key，在具备该实例 R2 只读凭据的恢复机执行以下命令。输出目录必须不存在，私钥留在离线恢复机：

```bash
pnpm db:recovery:fetch --completion-key '<completion-key>' --output /private/path/checkpoint
export RIVALHUB_RECOVERY_TARGET=isolated
export RIVALHUB_RECOVERY_DATABASE_URL='postgresql://...@127.0.0.1:.../postgres'
export RIVALHUB_BACKUP_AGE_IDENTITY_FILE=/private/path/age-identity.txt
unset RIVALHUB_ALLOW_REMOTE_DB_WRITE
pnpm db:recovery:restore-db-checkpoint \
  --artifact /private/path/checkpoint/artifact.tar.gz.age \
  --manifest /private/path/checkpoint/sidecar.json \
  --completion /private/path/checkpoint/completion.json
```

目标须是全新的隔离 Supabase/PostgreSQL；恢复工具版本须符合 [灾难恢复说明](./disaster-recovery.md#isolated-restore) 的来源版本与账本要求。核验成功仅证明隔离副本；本机自动回滚不会因为隔离恢复成功而启动旧程序。Hosted 数据库恢复、切换及重新接入仍须使用单独授权且已验证的恢复流程。

## 跨主版本转换

普通升级仍执行双向 reader-first 合同。跨 v2 → v3 必须在明确的维护窗口停止实例以外的所有 writer 和迁移执行者，并核实正在运行的来源项目与目标数据库；不得修改能力声明伪造兼容。旧金融 writer 已退役，仅切回旧应用不安全。以下入口在主机锁内复核实际运行身份及精确旧链和目标链，停止服务并排空事务，以旧环境生成完整 DB + Storage 加密 checkpoint，验证对象真实读回并将来源、目标、账本、Storage 摘要和候选身份绑定到事务，再持久化迁移标记并执行迁移/adopt：

```bash
sudo pnpm exec tsx scripts/instance/release.ts --major-transition \
  /path/to/manifest.layers.json /path/to/candidate-instance.env \
  --checkpoint-env /private/path/checkpoint.env --maintenance-window CHANGE-123
```

维护窗口标识是操作记录，不会停止外部 writer。checkpoint 环境与普通迁移相同，还必须包含实例 Storage secret、age 和独立 R2 配置。标记前失败可恢复旧应用；标记写入后任何失败均保持停机，`--rollback` 不能单独启动旧应用。

成对恢复必须继续保持全部 writer 停止，使用事务快照 `full-checkpoint.json` 中的 `completionKey`，通过 `pnpm db:recovery:fetch` 获取该完整 artifact，并按 [灾难恢复](disaster-recovery.md) 将其恢复到全新目标，使用 `--evidence-directory` 生成 full restore 验证证据。核实目标项目和凭据后，在原事务的同一 operator checkout 中运行：

```bash
sudo pnpm exec tsx scripts/instance/release.ts --restore-pair \
  /private/path/recovery-<run-id>.json /private/path/restored-instance.env
```

该入口在锁内核对证据与事务的 artifact、manifest、来源应用和恢复目标，再重新读取数据库账本与 bucket，只有验证通过才将旧应用和恢复目标配对启动；它不执行生产数据库恢复。恢复目标环境不得指向未经恢复的原数据库。恢复证据由操作员受保护目录保存，是一致性凭据而非数字签名；恢复后至启动期间也须保持外部 writer 停止。

当前新路径尚需隔离端到端演练；Hosted 目标恢复权限和真实 systemd 主机行为尚未验收。完整自托管 Supabase 需要独立工作包：定义非 Hosted 的 API/数据库身份与 TLS、密钥和 provider 配置合同，适配安装、备份、恢复与 scheduler，并在真实自托管组合中验证完整旅程。

## 备份与恢复边界

独立实例 full backup 使用既有 `db:recovery:backup`，显式设置 `RIVALHUB_BACKUP_SOURCE=instance`、非官方 `RIVALHUB_INSTANCE_PROJECT_REF` 与相同的 `RIVALHUB_INSTANCE_CONFIRM`，并提供该实例的应用 origin、API、Session Pooler 数据库连接、Storage secret key、age recipient 与独立 R2 配置。运行中的实例必须提供 `/api/system/recovery-source`：它只返回 release 和已公开的项目身份，备份会核对其实际运行配置、数据库项目、真实 commit 对象和版本派生的实例 release 标识，以及采集前后的账本。旧版本不支持此合同，不能靠手填身份替代。实例 artifact 位于 `instance/<project-ref>/`，该前缀的保留策略由实例运营者配置；官方 `production/` 策略不自动覆盖它。 本地端到端演练可显式使用 `RIVALHUB_BACKUP_SOURCE=isolated-instance`、`RIVALHUB_DB_TARGET=local` 和 `RIVALHUB_BACKUP_SUPABASE_WORKDIR`，并设置 loopback 的 `RIVALHUB_R2_LOCAL_ENDPOINT`；来源身份由 Local Supabase status 和运行中的本地应用读取。此类产物位于 `isolated/`，只允许恢复到隔离目标，不能作为 Hosted 激活凭证。

仅 full artifact 可以申请恢复证据。恢复到新的非官方 Hosted 项目时，显式设置 `RIVALHUB_RECOVERY_TARGET=instance`、`RIVALHUB_INSTANCE_WRITE=yes`、目标项目 ref 和确认值，以及目标 `RIVALHUB_RECOVERY_DATABASE_URL`、`RIVALHUB_RECOVERY_SUPABASE_URL`、`RIVALHUB_RECOVERY_PUBLISHABLE_KEY`、`RIVALHUB_RECOVERY_SERVICE_ROLE_KEY`。使用原有 `db:recovery:fetch` 和 `db:recovery:restore`，后者接受 `--evidence-directory` 指向恢复操作员拥有且权限为 0700 的目录。只有 artifact、数据、生命周期、Storage 和账本均验证通过后才生成权限 0600 的证据；DB-only checkpoint 不可生成证据。Hosted provider 的所需恢复权限尚未实机验证，权限拒绝必须停止处理。

新主机恢复后通过 `scripts/instance/release.ts --recover MANIFEST INSTANCE_ENV EVIDENCE` 调用现有控制器；控制器从受保护的恢复证据和 Git 实际提交读取前后身份及能力，安装器不接受单独的恢复绕过参数。安装前会核查受保护文件、恢复的真实目标、完整账本以及与备份相同的 release；然后再次读取实际数据库的账本和 bucket。无证据仍执行 fresh-only 检查。同机升级与后续应用切换仍须遵循现有 release 能力合同，恢复证据不自动授权跨版本升级。文件 checksum 和受保护目录提供一致性及运营者信任边界，并非备份来源的数字签名。

## Scheduler

应用可经公开 HTTPS 地址访问后，在与首次供给相同的受保护环境中运行：

```bash
RIVALHUB_INSTANCE_WRITE=yes pnpm exec tsx scripts/instance/provision.ts scheduler
pnpm exec tsx scripts/instance/provision.ts verify-scheduler
```

`scheduler` 使用同一现有 job registry、Vault 命名与 HTTP dispatch；`verify-scheduler` 触发实际 dispatch，需要可访问的应用和匹配的 `CRON_SECRET`。这些工具不配置 Supabase 内部服务。已有实例通过迁移入口先完成原不可变链、再核对物理合同并保留原账本证据后接入 v3；不要对其使用首次安装入口。当前 active baseline 身份与历史证据见 [baseline proof](../../drizzle/baseline-candidate/PROOF.md)。

## 验收边界

隔离 Local Supabase 已真实回放当前活跃迁移链，验证 Auth、Storage 对象生命周期、Data API 默认拒绝、scheduler dispatch 写入和 private Realtime 的订阅、跨比赛及写入拒绝；构件 readiness 对真实本地账本通过，对不匹配账本拒绝。安装脚本的临时目录演练验证了候选重启失败后的指针和配置恢复，以及排空失败时保持原指针与配置；演练中的 systemctl、HTTP、排空和 readiness 使用替身。

这些证据不构成 Hosted Supabase、session pooler、实际 systemd/Caddy 主机或完整自托管组合的验收，也不证明生产容量。真实项目仍需验证首次供给、公开 HTTPS、注册/邮件、首管、Storage、Realtime 与 scheduler；不能以替身结果代替实机验收。
