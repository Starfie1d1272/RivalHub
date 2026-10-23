# 2026-10-23 Linux 生产托管切换记录

本记录保存本次故障切换证据，不作为后续版本或服务状态的实时 authority。操作 SOP 见 [standby](../../operations/standby.md)，发布约束见 [release](../../operations/release.md)。时间为北京时间，附 UTC 的字段除外。

## 范围与身份

Vercel 团队因配额暂停，正式域名返回 HTTP 402 / DEPLOYMENT_DISABLED。Owner 授权把应用托管切到已有 Linux，保持 Supabase `eurxkguokrkvpcsmxuru` 的数据库、Auth、Storage、Realtime；本次未迁库、恢复备份或运行 migration，未停止其他业务或新增付费资源。

- 正式应用：`v2.21.10` / `30eb5e3a96fe493226ebaa7a74babe65ad879fc7`。
- 身份依据：immutable tag、exact-SHA main CI [39955202964](https://github.com/Starfie1d1272/RivalHub/actions/runs/39955202964)、成功 Release [39955591008](https://github.com/Starfie1d1272/RivalHub/actions/runs/39955591008) 的 canonical convergence，以及原 Vercel deployment `dpl_aFDLAovkiLhPnfcEh7iigpR64ias`。
- 构建工具：`633ef9284636872c15b5773eafd6322347f57268`；独立 Linux x64 生产包来自 [39979804136](https://github.com/Starfie1d1272/RivalHub/actions/runs/39979804136)，Node `24.22.1`。
- 公开配置 SHA-256：`ef286fc15be2b66afdd7a963ce0b0b2ea779b7f010b658d5e44c12d2c979a77b`。
- 包 SHA-256：`123bb0c1a4decb3114969339adbef1561acf76f250fff4df1ff1a5b43e3c4073`。

## 部署与路由

SSH 使用原有配置连接 `47.103.131.158:52222`，Debian 12 x64，2 CPU，约 1.64 GiB 内存，无 swap。生产服务 `rivalhub-production` 以独立同名系统用户运行于 `127.0.0.1:3032`，512 MiB memory limit。Preview 保持独立的 `rivalhub-standby` / `3031`。未在小服务器上构建。

23:51 左右将 `match.starfie1d.top` 从 DNS-only CNAME `fb8afb34c8aeffab.vercel-dns-017.com`（TTL 600）切为 DNS-only A `47.103.131.158`（TTL 300）。公共 DoH 回读 A 正确、AAAA/CNAME 无记录。旧缓存传播期间仍有请求命中 Vercel；新入口通过正式 SNI/Host 验证，Chrome 正式登录页已加载。

Caddy 配置 `/etc/caddy/rivalhub-production.caddy`，代理请求体上限 12 MB，Next Server Actions 保持 10 MiB。入口不带 Basic Auth，不增加共享 HTML 缓存。候选期 DNS challenge 预置有效证书；切换后已去除静态证书引用，由 Caddy 完成 TLS-ALPN 签证并记录自动续期计划。

生产 runtime 位于 `/etc/rivalhub-production/production.env`（600），操作员本机受保护副本为 `~/.config/rivalhub/credentials/production-linux.env`。Owner 分别批准轮换 `ADMIN_SESSION_SECRET` 和产品统计签名／账号匿名标识密钥；统计 Worker 仅更新 `SIGNING_KEY`，保留查询密钥及原保留／清理策略。用户需要重新登录，账号匿名统计标识发生变化。数据库密码、JWT、CRON_SECRET 和 Supabase 项目保持原值。Steam、Turnstile、OCR 与日志源使用核对后的现有凭据；未在记录中保存密钥值。

## 验证证据与限制

安装／恢复与环境隔离涉及生产凭据和故障恢复，执行了对应的 3 个定向 Node/tsx 测试、修改脚本的 ESLint、`bash -n`、完整 diff 检查，均通过。CI 生产包构建成功，安装时 SHA-256 与 runtime target guard 通过。Caddy 修改先 validate 后 reload；未运行普通业务全量测试。

| 项目 | 本次证据 |
| --- | --- |
| 生产身份 | 候选及正式域名 `/api/system/release` 返回精确 tag/commit |
| 页面与缓存 | 首页、两场比赛详情、登录页均 200；HTML 为 private/no-store；JS/CSS 为 immutable |
| 图片 | Next 本地图片优化 200；现生产 Storage 队标 JPEG 200 |
| Server Actions | 新构建登录 action 对无效邮箱返回预期校验，不建立会话；正式 Origin 经代理传递正常 |
| Auth | Supabase Auth health 200，正式回调域名已核对；owner 已在切换后确认真实账号登录成功 |
| Realtime | 正式 viewer endpoint 200；用其真实短期 token 加入对应 private receive-only channel，状态 SUBSCRIBED |
| Mizar | 未授权 schedule 请求按既有协议返回 403；实际 Windows/Mizar 凭据及推送尚未验收 |
| Provider | Steam 只读请求 200；旧 OCR key 401 后从另一现有本地配置恢复有效 key，models 请求 200；owner 随后提供的最新 key 与 Linux 一致。10 月 24 日同一合成记分板真实推理在 Linux / 本机均返回 10 行，耗时约 125 / 113 秒；真实业务曾记录 180 秒超时与 HTTP 500 / 50507，稳定性尚未恢复验证 |
| 产品统计 | 正式页面真实 bootstrap ticket 携带准确生产 commit，通过接收端验签后空 batch 被拒绝为 400；无效签名为 401。此检查不写统计事件；浏览器接收至存储全链尚未读取核对 |
| 运行日志 | journal 可读，exporter 配置启用；Better Stack 实际接收返回 402 / Quota reached，远端日志未恢复 |
| 调度 | 保留 pg_cron/pg_net + GitHub watchdog，未新建 cron；Vault base URL 与 CRON_SECRET 对齐；统计投影任务 UTC 15:55:00.110 dispatch、15:55:02.427 success，证明自然调度已到达新入口 |

现行 registry 有 9 个 job，health 表另保留旧 `refresh-steam-avatars` 行；不把历史行作为现行 job。每分钟 idle job 继续更新 trigger，没有新 dispatch 时按 canonical health contract 判定。GitHub watchdog 配置未改，本次未手动触发全任务，未以真实竞猜／MVP 结算制造验收。

journal 观察到未知／旧 Server Action ID（含 `x`）被拒绝；无法从该日志确认请求来源，新页面 action 验证通过。旧页面应刷新。尚无全量 HTTP 错误率证据，不能把探测成功率等同真实用户错误率。

候选只读探测样本：首页约 1.85 秒，比赛详情约 4.08–4.34 秒，静态资源约 30–46 ms，图片优化约 217 ms。切换后热态首页样本约 0.52 秒。样本包含冷启动／数据库查询成本，不代表生产 p95 或容量测试。

## 资源与回退

| 资源 | 安装前 | 切换后观察 |
| --- | --- | --- |
| 整机 available memory | 约 662 MiB | 约 504–561 MiB |
| Production cgroup memory | 未运行 | 约 112–177 MiB（随请求变化） |
| Preview cgroup memory | 约 99 MiB | 约 94 MiB |
| Production / Preview 自动重启 | — / 0 | 0 / 0 |
| PostgreSQL 会话快照 | 未采集同口径基线 | active 2、idle 9、state 空 1，含本次只读检查 |

初始磁盘约剩余 28 GiB，未发现近七天 OOM；本次无必要清理。内存的 buff/cache 可回收，未清空系统缓存或增加 swap。Production 配置更新进行了计划内 restart，`NRestarts=0` 指没有 systemd 故障重启。

服务器 `/root/rivalhub-cutover-20261023/` 保留原 Caddy、DNS/TTL、服务和资源快照、包与校验和。当前 production 包保留在 `/opt/rivalhub-production/releases/`；这是首次生产安装，没有上一 Linux 生产版本可回退。安装器的空 previous-release 不能作为有效上一版本。

回退 Vercel 前先确认原 deployment 已恢复服务并通过 exact identity/业务检查，再恢复上述 CNAME 和 TTL 600；保留 Linux 服务至少一个旧 TTL 窗口。Vercel 原配置保留了旧会话及统计密钥，回退验收必须处理重新登录，并通过受保护配置发布让统计签名与当前 Worker 一致。Vercel 仍暂停时，恢复 DNS 只恢复路由，网站仍会返回 402。Supabase 数据持续使用同一份，不做反向数据库恢复。代理异常可恢复备份中的 Caddy 配置，validate 后 reload；这不会自动恢复应用可用性。

后续发布的 Linux 默认路径与 Vercel 回退路径由本次 PR 更新，须进入 main 后才成为正式 workflow；不能把 feature branch 的验证等同新 tag 发布完成。

## 2026-10-24 访问反馈补充

Owner 已确认在正式域名完成真实登录。一位使用搜狗浏览器的访客报告连接重置，切换 Edge 后恢复访问；尚未确定该浏览器内核或具体失败链路。服务器 loopback 强制 TLS 1.2 请求返回 200。本机经 Clash TUN 的对照中，同 IP 多个域名 TLS 1.2 重置、TLS 1.3 成功，因此该本机结果不能代表所有公网客户端。保持现有生产 TLS 配置。上传器日志显示 Python 3.12.10 在 SSL 握手阶段被 WinError 10054 重置，未获得 HTTP 响应；尚未确认失败 Windows 的协商细节。临时诊断域名验证 Cloudflare 入口能完成 TLS 1.2/1.3 握手，但 Python User-Agent 返回 403 / 1010；正式域名仍为 DNS-only，代理路径还需客户端规则与 OCR 长请求验收。

## 2026-10-24 正式发布流程验证

Release 默认目标改为 Linux，保留显式 Vercel 路径。Owner 授权后新增 GitHub production 专用 SSH key，使用独立 key、固定 host key 与 `restrict` authorized_keys 选项；runtime 用户继续为 `rivalhub-production`。GitHub 已配置公开构建 JSON、host key 与部署 secret，私钥未写入仓库。操作员受保护副本为 `~/.config/rivalhub/credentials/github-linux-deploy.key`。

使用新 controller、安装器与该专用 key，在真实主机重新安装现有 v2.21.10 包，checksum、主机首页/版本与公网 canonical 首页/版本全部通过。正式 SHA 保持 `30eb5e3a96fe493226ebaa7a74babe65ad879fc7`，数据库未变更。恢复快照为 `/opt/rivalhub-production/rollback/20261023T161607Z.fjudhKbD`；应用停止等待可达到 systemd 的 30 秒超时，因此单实例发布有短暂不可用窗口。

本地通过 scripts 类型检查、定向 ESLint、workflow YAML 解析、5 项 routing failure tests 与主机恢复模拟测试。模拟覆盖重启/健康失败、断线补偿、不可变包重试、同版本重新构建与锁拒绝。尚未通过 main/tag 运行完整新版 Release workflow，也未在真实服务器注入故障演练回退；这些证据与同版本真实安装分别记录。

## 2026-10-24 运行时缓存修复

Next.js 当前版本把运行时路由缓存写入 `.next/server/route-cache`。初始 systemd 沙箱只开放 `.next/cache`，日志出现 route-cache mkdir ENOENT。安装器现预建两个精确目录并赋予应用用户写权限，unit 仅开放这两个目录；包完整性比较排除运行时缓存。线上应用同样配置后，首页 200、exact v2.21.10 身份不变，route-cache 已生成 index.html/meta/RSC 缓存，自动重启计数为 0。构建代码保持只读。
