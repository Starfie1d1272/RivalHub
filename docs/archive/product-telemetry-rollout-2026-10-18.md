# RivalHub 遥测部署准备核验（2026-10-18 UTC）

这是一次部署前快照，不是接收端上线验收。源码基线为 `f9fc6ee02276a5e87c4a21bcd978315c97a06438`，包含已合并 #976/#977。未修改 Cloudflare/Vercel 配置、持续凭据、业务数据或采集开关。

## 已核实的事实

- `https://match.starfie1d.top/api/system/release` 返回 `v2.18.0` / 上述 commit；同 origin `POST /api/product-telemetry` 返回 HTTP 200、JSON `null`。这证明当前匿名签发不可用，不能仅据 null 推断所有变量均不存在；开关、缺失/非法配置或签发降级均可造成 null。
- Vercel 已连接团队 `team_0eIkBawGTdVjwYHdyrb20ZVV`（`starfie1d1272s-projects`）；项目为 `rival-hub`，ID `prj_3bjmfKrSqRh4szrkEE4HpavnhI0E`。限定团队的项目列表读取成功。
- 对该项目列环境变量、`decrypt=false` 的请求被 API 明确拒绝：403 / `forbidden` / `projectEnvVars`。没有请求解密值。CLI 同目标回退报告 `No existing credentials found`，没有运行 login 或借用 Release secret。
- 当前执行环境无 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_API_KEY` / Vercel token；没有已有 Wrangler/Vercel CLI 登录态或 Cloudflare 连接器。Wrangler `whoami` 返回未认证；未发起登录。部署准备的只读 inventory 也明确报告缺少访问，不能断言网站 Worker/D1 不存在。
- 主会话提供的 Cloudflare account `754634a82d628d202a3da6771b5fb348` 仅是候选目标，已知 Mizar 空 D1/R2 不属于本网站资源。未借用或绑定它们，未核实该 account 的 Free 订阅、共享余量、workers.dev 子域或 RivalHub 独立资源 UUID。
- [Cloudflare Time Travel 文档](https://developers.cloudflare.com/d1/reference/time-travel/) 明确 always on；Free 恢复窗口七天。上线策略必须接受 active raw 七天读端截止、小时分块删除和额外恢复历史的差别；不能承诺全副本物理七天。长期汇总默认仍是 `0`，90 天只属于代码技术上限。

## 可交付的执行准备

- `scripts/telemetry/prepare.ts`：只读 metadata inventory，或在忽略目录生成独立环境的全关配置；不开登录、不创建密钥、不部署。
- `scripts/telemetry/verify-live.ts`：显式许可后访问实际网站，等待页面 observer 自然批量发送，核对 ACK 与 D1-backed 解压读取、精确版本及访问边界；不执行业务写入，不保存原始事件、ticket、账号或 HAR。
- `docs/operations/product-telemetry.md`：目标、最小权限/密钥表、空库 schema 检查与初始化命令、隔离 Preview → Production 顺序、环境变量必须经新候选构建才生效、停止采集时保留清理的操作步骤。

## 本地验证

- scripts TypeScript 与两个文件 ESLint、`git diff --check` 通过。
- 生成 Preview/Production 本地配置：三个开关全 `0`，日志与 Preview URL 关闭，使用独立 Worker/D1 名称和显式账户/origin。
- 临时检查验证文件存在时不覆盖、非法 origin 拒绝、缺少实时测试许可时在配置阶段失败，输出不含所注入的假 operator key。
- Wrangler 4.151.1 `deploy --dry-run` 使用占位 D1 UUID `00000000-0000-4000-8000-000000000000` 成功；上传估计 29.99 KiB、gzip 8.48 KiB，**没有上传**。占位 UUID 不是实际资源，dry-run 不证明资源存在或云端额度/CPU。
- `pnpm exec vitest run --project unit-domain-node tests/unit/telemetry/worker.test.ts` 通过：本地真实 workerd/D1 的并发 ACK 去重、usage、gzip 读回和关闭日汇总。不是 hosted D1 计费或全链路线上验收。

## 继续执行所缺的具体条件

1. 已批准的 Cloudflare 只读访问以核对候选账户的 Worker/D1 清单、Free 计划、共享请求/读写/存储余量和 workers.dev 子域；若同名资源存在，先查绑定/schema，不覆盖。此读取本身已在任务范围内，但当前没有访问手段；不要在聊天粘贴 token。
2. 确认独立 Preview/Production Worker + 空 D1 的账户和创建/部署权限；若需要新 provider token，须先确认账户权限范围和到期时间。无需 R2/Zone/付费。部署先全关，网站仍关闭。
3. 确认每环境独立 signing/account/operator 密钥的受控生成和注入、指定项目环境变量管理权限；只把 signing/account 配到网站，operator 仅留在受控运维终端。
4. 确认 raw 七天 active、小时删除及 D1 额外七天恢复历史取舍（故障可延长，不能保证绝对十四天）；汇总继续 `0` 即可推进基础采集。长期版本比较的具体汇总天数可以单独决定。
5. 许可先在固定 Preview origin 产生少量测试遥测，拿到真实 browser → ACK → D1 → operator 读取证据和 provider 用量后，再确认 Production 配置候选发布与开流量。实际网站 URL、receiver URL、DB UUID、构建 commit、启用时间及窗口前后用量应进入最终回执。
