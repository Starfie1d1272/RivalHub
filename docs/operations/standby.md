# 应用备用机与 Vercel 故障切换

本手册管理官方实例的应用层备用机。当前安装目标为 **Preview 验收环境**：`preview-standby.starfie1d.top`，只连接 `rivalhub-dev`，使用独立访问密码。生产域名仍由 Vercel 提供服务，Supabase 保持现有数据库、Auth、Storage 和 Realtime 服务。

## 当前能力与生产切换前置条件

`Standby Preview package` workflow 在 Linux x64 打包 Next.js standalone、静态资源和锁定的 Node runtime。`standby.json` 记录精确 commit、公开环境配置和 runtime 版本；启动时复用 canonical Preview guard，拒绝 production DB/Auth URL、环境标志或构建后更改公开配置。

**Preview 包不能直接改环境变量接入生产。** 公共 Supabase key 和应用 URL 已内联到浏览器资源。正式切换前必须通过 [release authority](./release.md) 建立并验收受保护的 production standalone 构建、凭据交付与部署路径，以当前 immutable release tag 为输入，构建 production public configuration，并回读同一 tag/commit。本 PR 只交付 Preview 打包和安装路径；上述 production 发布路径尚未实现、尚未演练，因此当前状态不属于“一条命令即可接管生产”。

生产路径准备完成后，在故障前保留以下材料：当前正式 tag/commit、对应 Linux production 包及校验和、完整生产 runtime 配置、原 DNS 记录与 TTL、Caddy 配置备份、候选实例的验收记录。凭据存入服务器 root-only 文件或既有受保护 secret store；记录里仅保留变量名和来源。

## Preview 安装与更新

1. PR 构建读取仓库变量 `RIVALHUB_PREVIEW_PUBLISHABLE_KEY`，只含 dev 公开 key。main 合并后可手动运行 `standby-package.yml`；下载对应 run 的 `standby-preview-linux-x64` artifact，核对 run SHA 与包名。
2. 单独准备 dev runtime 配置：参见 [Preview mirror](./preview-mirror.md#vercel-preview-必须配置)。另设 `NODE_ENV=production`、`VERCEL_ENV=preview`、`RIVALHUB_DB_TARGET=preview`、`HOSTNAME=127.0.0.1`、`PORT=3031`、`NEXT_PUBLIC_APP_URL=https://preview-standby.starfie1d.top`、`NODE_OPTIONS=--max-old-space-size=320`。`ADMIN_SESSION_SECRET`、`CRON_SECRET` 使用本环境独立随机值。禁止把 Vercel 整份导出或 production secret 文件直接复制到服务器。
3. 若现有 dev DB password 只在 GitHub staging secret 中，操作员可生成临时 RSA-4096 key，仅将公钥写入 `RIVALHUB_STANDBY_OPERATOR_PUBLIC_KEY`，手动运行 workflow。受保护 staging job 将密码用 RSA-OAEP-SHA256 封装给该公钥；本地验证 project ref 和 recipient fingerprint 后解密。私钥留在本地；取用后删除临时公钥变量、密文 artifact 和临时明文副本。日常 PR 不触发凭据交付。
4. 通过 SSH 传输包、`.sha256`、私有环境文件，以及同一 commit 的 `install-preview.sh`、`rivalhub-standby.service`；在目标 Linux 主机以 root 运行：

   ```bash
   bash install-preview.sh /root/incoming/rivalhub-standby-<COMMIT>.tar.gz /root/incoming/preview.env
   ```

   安装器核验包、目标环境和启动身份，原子切换 `current`，失败时恢复上一版本和环境。首次安装失败会停止服务。成功的身份检查仅证明进程和版本，仍需页面与角色态验收。
5. 按 [`Caddyfile.example`](../../scripts/standby/Caddyfile.example) 设置独立 HTTPS 入口。使用 `caddy hash-password` 生成访问密码 hash；先备份已有 Caddyfile，新增本应用独立 import，执行 `caddy validate --config /etc/caddy/Caddyfile` 后再 reload。不要替换其它服务配置。使用有效证书验证 HTTPS；未认证必须返回 401。

服务由 systemd 管理，独立系统用户、loopback 端口、512 MiB 内存上限，写权限限于 Next cache 目录。应用凭据由 `/etc/rivalhub-standby/preview.env` 提供，权限 600。历史包位于 `/opt/rivalhub-standby/releases/`；更新保留上一包。重启不恢复业务数据，Preview 数据由既有 refresh workflow 管理。

```bash
systemctl status rivalhub-standby
systemctl show rivalhub-standby -p MemoryCurrent -p NRestarts
journalctl -u rivalhub-standby --since '10 minutes ago'
curl --fail http://127.0.0.1:3031/api/system/release
```

本机不设置第二份 cron。Preview 没有生产邮件/OCR 等 provider 凭据，对应功能保持现有 fail-closed 行为；日志保留在 journal，尚未配置远端日志 exporter。

## 公共缓存与验收

现有 `use cache: remote` 的公共 read model 保留原有 TTL/tag 失效边界；当前 Next.js 内置实现在自托管未配置 remote handler 时使用进程内 handler。单进程可复用缓存，重启后重新预热。Vercel Preview 与备用机各有独立缓存，跨实例写入不传播内存 tag 失效，另一实例按原 TTL 刷新；因此验收更新时必须在同一实例验证。以后增加多副本时，需要共享 cache handler 或失效广播，并单独验证。

验收顺序：401 访问保护 → HTTPS release identity → 首页和赛事 → persona 登录 → 角色权限 → Preview 可恢复写入及刷新回读 → 静态资源/图片 → 进程重启后恢复。竞猜只做读路径验收时，不得声称已验证下单、结算或资金一致性。Storage、Realtime 和外部 provider 未实际完成的场景需单独列明。

## Vercel 停用后的切换顺序

此流程在 production standalone 前置条件完成后执行；故障发生时若只有 Preview 包，先恢复 Vercel 服务，并完成 production 发布路径，不能用 dev 数据对外替代生产。

1. **判定故障范围。** 从两个网络检查 `https://match.starfie1d.top/api/system/release`、主要页面、Vercel 状态及 Supabase 可用性。应用备用机能替代 Vercel 计算和静态资源；Supabase 配额/停服仍会影响两端。
2. **冻结版本与源数据。** 使用最近一次成功的 canonical production read-back 和 immutable tag 校验 commit。确认候选包与现有 schema 兼容。切换本身不运行 migration、不导入备份、不修改 Supabase 项目。数据库故障走 [disaster recovery](./disaster-recovery.md)。
3. **启动生产候选。** 使用独立 production 服务、端口和目录，保持当前 Preview 实例隔离。使用正式域名的构建参数和受保护生产 runtime 配置。先用 `curl --resolve match.starfie1d.top:443:<SERVER_IP>` 验证实际证书、release identity 和页面；TLS 证书必须提前准备（DNS challenge 或经授权的验证切换）。用浏览器 hosts/DNS 预演验证登录、Server Actions、图片和实时连接，记录原 DNS 以便恢复。
4. **检查会话与请求边界。** 同域名、兼容版本和相同 session signing secret 才可能延续旧会话；使用不同 signing secret 时安排重新登录。核对 Supabase Auth redirect allowlist、Steam callback、代理转发 Host/Proto、上传大小限制与 Next image 配置。生产 Caddy 入口不能保留 Preview Basic Auth，否则用户和 scheduler 都会被拦截。
5. **切 DNS。** 事前将正式域名 TTL 降到约 300 秒并等待旧 TTL 过期；故障时修改正式域名现有记录指向备用机，处理冲突的 CNAME/A/AAAA。保留旧 Vercel domain/project 和部署。不要提前停掉仍可服务的旧实例；传播期两个实例必须使用同一兼容版本与同一 Supabase。
6. **读回与观察。** 多网络核对 DNS、证书、exact release identity；验收登录和核心读写，观察 5xx、延迟、数据库连接、内存与重启计数。第一波缓存冷启动需要重新查询，不能把 Preview 的低并发内存结果视为生产容量保证。
7. **核对调度。** 生产 primary 为 Supabase pg_cron/pg_net，watchdog 为 GitHub Actions，二者经正式域名调用应用。正式域名和 CRON_SECRET 保持一致时 DNS 切换会改变落点；核对 Vault 中实际 base URL，以及 canonical scheduler health 中 fresh primary trigger 与 endpoint success。只保留既有调度 owner，不在服务器另加一份 cron。若需改变配置，走受保护 production provisioning path。

## 回退到 Vercel

1. 确认 Vercel 已恢复，并以候选部署 URL/受保护 smoke 验证与当前生产 schema 兼容的 exact release。不要把仅本地构建成功当作回退条件。
2. 恢复切换前保存的正式域名 DNS 记录；保留备用应用运行至少一个旧 TTL 窗口，避免尚未更新 DNS 的客户端断开。
3. 从两个网络读回正式 `/api/system/release`，验证登录、核心读写与 scheduler health。Supabase 持续使用同一份数据，不进行反向数据复制或数据库回滚。
4. DNS 收敛、流量和调度恢复后，停止 production 备用服务并恢复其访问限制，保留包和脱敏运行证据。Preview 备用实例继续用于演练。

若仅 Preview 新包失败，可先停止服务，将 `current` 原子切回 `/opt/rivalhub-standby/previous-release` 中记录的相对路径，恢复匹配的 `preview.env.previous`，再启动并核对 `/api/system/release`。目标包为空或已移除时停止，不能猜测版本。
