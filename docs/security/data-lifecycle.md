# 数据分类与生命周期

本页回答持久化数据的目的、可见性、保留与删除/恢复边界。精确字段以 schema、serializer、active migrations 和测试为准；清理、鉴权、结算与恢复继续由原领域 owner 执行。各类数据按下文明确的业务目的保留；现有到期清理继续由对应 owner 执行。

“公开”指允许公开的 DTO，不指整行数据可由浏览器读取。同一行含不同敏感级别字段时，按最敏感字段保护持久化与备份，按字段投影决定可见性。PostgreSQL 默认 server-only；浏览器访问基线见 [数据库访问矩阵](database-access-matrix.md)。

## 分类与使用目的

| 类别 / owner | 目的与存储 | 可见性与敏感性 |
| --- | --- | --- |
| 赛事、名单、比赛、赛果、奖项；[domain model](../domain-model.md) | PostgreSQL 保存正式历史与冻结归属 | 发布后的正式 DTO 为 public；报名、审核、后台操作字段为 private |
| 长期 Team / Player 展示；[身份展示](../../src/lib/identity/display-name.ts) | PostgreSQL 保存当前昵称、自述与组织身份 | 允许公开的资料为 public；整行用户资料不是公开 DTO |
| 账号、凭据绑定与归并；[users](../../src/db/schema/users.ts)、[identity](../../src/db/schema/identity.ts)、[auth](../auth-and-permissions.md) | PostgreSQL 保存 canonical person、邮箱归属、外部身份、provenance；Supabase Auth 拥有密码/provider 身份 | 邮箱、Auth subject、归并证据为 private/sensitive，self / 授权管理员 / server-only |
| 登录页面更新草稿；[login-update-draft](../../src/lib/auth/login-update-draft.ts) | 用户明确点击更新时仅将当前邮箱存入同标签页 sessionStorage，供更新后一次恢复 | 不保存密码、验证码、Turnstile/session票据；15分钟后读端拒绝，读取时删除、关闭标签页清除，不进入服务端、日志或备份；不自动重放提交 |
| 联系方式、报名草稿、legacy studentId；[users](../../src/db/schema/users.ts)、[drafts](../../src/db/schema/registration-drafts.ts) | PostgreSQL 保存报名/联系资料；studentId 不作为 Major 资格依据 | private/sensitive，按报名管理权限读取；主动公布的赛事联系方式不使账号联系方式成为公开数据 |
| 高校目录与认证结论；[education](../../src/db/schema/education.ts) | PostgreSQL 保存目录来源、认证结论与审核历史 | 目录和允许公开的身份结论为 public；审核备注等为 private |
| 教育核验材料；[retention policy](../../src/lib/education/retention-policy.ts)、[Storage](../../src/lib/education/storage.ts) | PostgreSQL 保存 CHSI code/private object reference；private Storage 保存人工材料 | sensitive；材料签名入口仅超级管理员。code、object key、文件、signed URL 不入 public DTO/log |
| 纪律、申诉与裁决；[discipline](../../src/db/schema/discipline.ts)、[BP](../../src/db/schema/match-veto-room.ts) | PostgreSQL 保存正式处理、理由与证据范围 | 允许公示的说明/结果为 public；内部证据、申诉理由按 self / 赛事管理员授权 |
| 免费赛果与 BP；[免费预测 owner](../decisions/free-predictions.md) | PostgreSQL 保存当前选择、私有修订与永久截止事实；成绩消费当前正式事实投影 | 选择/revision 为 self/server-only；匿名支持率与公开成绩为 public DTO，浏览器 Data API 拒绝 |
| 积分参与与结算账本；[BET](../../src/db/schema/bet.ts)、[预测](../operations/spectator-predictions.md) | PostgreSQL 保存参与条款、锁定、幂等与余额守恒证据 | 市场 DTO 可 public；账号参与、私有账本按原 owner 授权 |
| Demo/OCR 与出场身份；[Demo](../../src/lib/demo-integration/submit.ts)、[gameplay identity](../../src/db/schema/gameplay-identity.ts) | PostgreSQL 保存上传数据、待核对身份、正式统计与 provenance | 原 payload/诊断为 private/sensitive；public 统计消费 canonical projection；OCR request 不成为日志附件 |
| Mizar/DAK 配对与设备；[Mizar](../../src/db/schema/mizar.ts)、[pairing](../../src/lib/integrations/pairing-security.ts) | PostgreSQL 保存授权、verifier/poll hash、有效期、撤销关系与可靠事件 receipts | verifier 为 secret，设备关系为 private/server-only；机器/授权人 DTO 不输出 credential；raw secret 不写 audit/log；管理员来源报告仅输出限定身份、健康和回执摘要，关闭保留原会话及回执，审计记录精确身份与核对事实 |
| Application session；[registry](../../src/lib/auth/session-registry.ts) | PostgreSQL 保存随机会话 ID、有效期、durable revocation fence；浏览器持受保护 cookie | sensitive/server-only；会话 ID 有授权价值，不是公开用户身份；cookie 不入日志 |
| 在线心跳；[user_sessions](../../src/db/schema/user-sessions.ts)、[presence](../../src/lib/presence/server.ts) | PostgreSQL 最近活跃时间用于后台活跃账号统计；单进程承载用内存维护近两分钟活跃登录账号数 | private、不参与鉴权；内存只保存账号 ID、最近心跳及五分钟写入节流状态，最多 10,000 个账号，闲置五分钟后在后续登记时清理；重启即清空、不备份、不导出；PostgreSQL 复用既有账号删除/归并生命周期 |
| 管理员 grants/邀请；[access](../../src/lib/auth/admin-access.ts)、[invites](../../src/lib/auth/admin-invites.ts) | PostgreSQL 保存授权边界、邀请/认领与撤销事实 | private/sensitive，授权后台/server-only；关系展示不输出邀请 token |
| 反馈；[schema](../../src/db/schema/feedback.ts)、[commands](../../src/lib/feedback/commands.ts) | PostgreSQL 保存文本、最小 pathname、版本、triage 状态、内部去重指纹 | private，超级管理员处理；自由文本可能 sensitive；指纹不入 DTO，不保存完整 URL query/raw logs |
| 业务 audit；[write owner](../../src/lib/audit/write.ts) | PostgreSQL 保存谁改变哪些业务事实 | private，按全局/赛事权限投影；不展开 raw meta，不补造未知历史 |
| 产品遥测；[owner/部署清单](../operations/product-telemetry.md) | 独立、默认关闭的 Worker/D1 保存白名单事件；七天账号/会话排障、页面/任务步骤与活跃时长、有限校验原因及性能基线；可选无直接身份日聚合支持赛事周期分析 | private/operator-only；产品专用 HMAC 账号、随机诊断 session；不含鉴权 session/凭据/正文 |
| Runtime telemetry；[observability](../operations/observability.md) | 服务 journal 保存脱敏日志与本地运行诊断 | private，运维授权；不成为业务审计，不复制到 application DB |
| Cache/projection/scheduler health；[统计](../operations/statistics-projections.md)、[scheduler](../deployment.md) | PostgreSQL/runtime cache 保存可重建统计、Steam profile cache、有界当前健康 | 仍按 DTO 输出；freshness/失效不等于物理删除，projection 不是 source fact |
| Mizar 逐图临时数据；[match maps](../../src/db/schema/match-maps.ts) | 每张地图最多保留一份身份已匹配的基础计分板快照，供公开赛后展示 | 未核对且不参与正式统计；正式确认行优先；与比赛地图同寿命并随数据库备份/恢复，不设置计时过期；回执保留事件关联用于幂等及来源核验 |
| 浏览器上一帧；[previous view owner](../../src/lib/mizar/live-previous-view.ts) | 同标签页 sessionStorage 暂存最多两场匿名公开计分表，减少连接期间的空白 | 仅 public display values 与 opaque revision；不存 token、cookie、用户/source 身份、雷达或运行时钟，不是正式赛果或事件 replay |
| 公开运营图片；[Storage registry](../../scripts/db/recovery/storage-policy.ts) | public Storage 保存队标、赛事 Logo/群二维码 | 对象为 public，上传权限与内部 inventory 仍 server-only |
| 环境/provider secret；[部署](../deployment.md) | Vercel/GitHub protected configuration、Vault、provider 拥有运行凭据 | secret，不导出值到文档/PR/log/普通应用备份；DB 内 verifier hash 按上述设备/身份类别另行保护 |

## 保留、到期与删除

| 类别 | 保留 / 触发 | 删除或匿名化 / evidence |
| --- | --- | --- |
| 正式赛事、冻结名单、赛果、奖项、裁决、积分账本 | 长期可追溯历史；改名、解绑、归档不是删除触发 | 正式更正/撤销由原 owner 与审计处理；不重写当时归属。账号删除后的匿名化范围尚需独立契约；见 [workflows](../workflows.md) |
| 当前账号、联系方式、报名草稿、legacy 私有字段 | 按账号使用、办赛联系和报名续填目的保留，不设置统一定期删除 | identity/auth 处理凭据撤销、归并与会话失效；保留既有更新和删除行为，通用账号删除产品尚未实现 |
| 教育目录、认证结论、审核历史 | 保留审核事实，与证据分开 | 清理 code/object 不删除学校、已通过/驳回、审核时间与结论 |
| Completed 教育核验材料 | `reviewedAt` 达 canonical 七天 cutoff 后到期；pending 不按提交时间推断到期，缺审核时间不补造 | 新列表/搜索/签名请求不再提供到期 evidence。[retention](../../src/lib/education/retention.ts) 删除对象成功后才清 DB key，CHSI code 清空；失败交既有 scheduler 重试。已签发短期 URL 仍受 adapter TTL/对象删除约束，读端不能撤销它；[签名入口](../../src/lib/education/evidence-access.ts)、[列表 DB](../../tests/integration/db/education-admin-review.test.ts)、[清理 DB](../../tests/integration/db/education-manual-retention.test.ts) |
| Pending 教育审核/未完成身份请求 | pending 教育材料保留至审核完成，再按审核后七天清理；身份请求按办理用途保留，有 expiresAt 的授权请求到期不可使用 | 不按提交时间自动判定放弃；由审核流程处理积压，复用现有材料清理 owner |
| Demo import/receipt/私有诊断 | 为导入排障、赛果更正和来源追溯保留，不设置统一固定 purge 期限 | 保留现有领域删除与关联生命周期；原始数据和诊断保持私有，正式统计继续由 canonical projection 提供 |
| 设备 verifier、配对/邀请、会话 | 原 owner expiresAt/撤销控制使用资格；session 有 canonical 有效期 | registry 注册时清该用户过期会话，退出/全撤销删除记录，durable fence 保留；设备撤销保留关系/audit。失效 intents/receipts 未有统一物理 purge |
| 反馈 | 为问题跟进、重复问题识别与历史排障保留；resolved 后不设置自动删除期限 | 状态更新保留 body/pathname/fingerprint，访问继续限超级管理员；主动撤回或匿名化产品未实现 |
| 业务 audit | 当前无统一自动 purge，维护正式追溯 | 低敏写入与安全投影不使历史 raw/private meta 公开；未来脱敏需定义责任追溯、tombstone、授权关系 |
| 产品遥测 | 压缩 raw/索引及短期聚合关联键至多七天；两类长期汇总各自默认关闭，启用时明确 1–90 天；任务 attempt 仅客户端内存，身份切换清空 | 读端到期不可见、小时任务分块删行，不保证所有副本七天物理擦除；D1 Time Travel 恢复副本可能在行删除后另存七天，清理故障还会延后，必须按 [产品遥测清单](../operations/product-telemetry.md) 确认总保留要求；恢复前停收并清过期数据；不进入应用 PG 备份 |
| Runtime telemetry | provider-managed，按当前 project/source/plan 核验 | provider 管理过期；仓库采样率不能推出保留期，ingest secret presence 不能证明查询权限。实际配置/owner/核验时间留在执行 Issue |
| Cache/projection/心跳 | 原 owner freshness、invalidation、reducer version | 由 canonical facts 重建；恢复旧缓存不能绕过身份/资格/处罚/撤销校验。心跳无独立历史 purge，不能宣传已到期物理删除 |
| 浏览器上一帧 | 原服务端收帧时间后 30 秒；恢复前必须取得 fresh viewer proof，未知资格、上下文/地图/登录变化清除 | owner 在期限安排标签页清理，读端始终拒绝超期；浏览器冻结时物理清理可能延后。登录/退出清除，不进入 application DB、备份或灾难恢复输入；恢复不会刷新原时间 |
| 公开 Storage assets | durable，按队伍/赛事使用目的保留，无统一 TTL | 对应上传 owner 管理替换/删除，恢复 registry 为 always，不与临时敏感材料套同一规则 |

## Backup 与恢复

[灾难恢复 runbook](../operations/disaster-recovery.md) 是执行 owner。本页定义哪些数据可重新成为 active，不能替代 protected recovery 程序或生产授权。

| 存储面 | Backup 删除/保留语义 | 恢复前边界 |
| --- | --- | --- |
| PostgreSQL public / Supabase auth | canonical encrypted backup 包含两者数据及私有字段/verifier hash；主库清理不修改已生成 immutable artifact | 按 exact migration/source 验证 Auth/业务关系。旧 snapshot 不含其创建后发生的撤销、归并或删除，不能声称自带最新状态 |
| 教育 private Storage/code | active business copy 七天，encrypted DR copy 受 R2 policy 最长三十天约束，目的不同 | [shared retention core](../../src/lib/education/retention-core.ts) 用隔离适配器先清到期引用/code；[Storage registry](../../scripts/db/recovery/storage-policy.ts) 只恢复 active-reference-only 敏感对象，未知 bucket fail closed，不重新激活到期/失去引用的材料 |
| Durable public Storage | registry 的 durable bucket 为 always；普通 DB dump 不包含 Storage 对象 | 完整 snapshot、bucket/policy 与对象校验；DB-only checkpoint 不能冒称 Storage backup |
| Encrypted recovery R2 | [R2 owner](../../scripts/db/recovery/r2-config.ts) 定义三十天 lifecycle/lock/private access | 需实际 rule/lock/domain read-back；代码/verify 不能代替其它 provider backup 的保留事实 |
| Supabase physical backup/PITR | provider plan 决定，仓库不能推出具体天数 | provider owner 记录 plan、能力、窗口、核验时间；不以 R2 三十天替代 Supabase 事实 |
| Session/机器授权/身份撤销 | 旧 snapshot 可能恢复旧 revocation fence/installation；时间过期检查不找回 snapshot 之后丢失的撤销事实 | 恢复后由维护者根据已知变更重新处理账号、会话和设备撤销，核对管理员权限与身份归并；接受备份窗口内变更丢失风险，操作顺序见灾难恢复 runbook |
| Cache/scheduler health/telemetry | DB snapshot 可能含旧 projection；外部 telemetry 不是 application restore input | 统计按 reducer/version 重建，健康重新观测，cache 由原 owner 失效，telemetry 由 provider 管理，不向业务 DB 导入 |
| Vault、环境/provider secret | canonical 恢复不复制 Vault/root encryption/provider config secret | 冷启动由 provider owner 单独重建并验证 presence；Auth/schema 中受保护的 verifier/credential 数据按对应备份类别处理，不从文档重建 secret |

恢复先在隔离目标验证，scheduler 最后 provision。尚未定义删除策略的自由文本/个人资料不能借恢复随意 purge；快照之后的权限变更按灾难恢复 runbook 人工重新处理。

## 社区奖名单与核验

社区奖 service 拥有完整获奖者关系及证据核验，目的为结奖、更正与追溯。名单按现有奖项公开范围投影；候选证据、处理人、时间与内部备注只供本届授权管理员，不进入公开 DTO 或浏览器 Data API。它们沿用赛事历史和审计的长期保留目的，无新增定时清理；删除奖项时关联名单/证据随 award FK 级联删除，用户历史核验 actor 保留原身份，账号归并由身份 owner 委托社区奖名单 owner 去重并同步旧投影。PostgreSQL 备份包含这些关联及内部字段，恢复须保留同一迁移版本、外键、延迟约束与审计；恢复旧快照不会自动包含快照后的更正。通用账号删除/历史匿名化仍按既有缺口管理。

## 新持久化类别规则

新增或扩大持久化范围，同变更说明 owner、purpose、storage/visibility、sensitive fields、retention 或长期理由、expiry trigger、删除/匿名化 owner、backup/restore 语义与最小 evidence。已有类别引用本页与原代码 owner，不复制清理任务；新 fixed retention 必须验证边界、幂等和失败重试。

核验只读 schema、serializer、policy、低敏 provider 配置，记录 presence/owner/capability/retention 与时间。真实用户行、教育文件、object key、signed URL、credential、raw dump 不进入 Issue/PR。跨域删除、迁移或 provider destructive 操作另开限定任务，不新增复杂审批平台。

## Evidence 与缺口分类

A 为已有 contract/自动证据；B 为 contract 已定但当前 provider 配置/自动核验不足；C 为保留/删除尚未定义；D 为可复现访问/恢复错误。未知不能写成已落实。

- A：completed-review cutoff、对象先删后清引用、private Storage/授权签名；[education DB](../../tests/integration/db/education-evidence-retention.test.ts)。Browser Data API 继续由 [access matrix](../../scripts/db/access-matrix.ts) deny-by-default。
- A：敏感对象 active-reference-only、未知 bucket 拒绝；实现由 [对象恢复 owner](../../scripts/db/recovery/storage.ts) 与 [Storage policy](../../scripts/db/recovery/storage-policy.ts) 承接。实现引用不代表隔离恢复验收；已退役的访问/恢复单测及其覆盖缺口见 [测试清理记录](../archive/testing-retention-2026-10-12/files.csv)，不能声称逐断言等价替代。R2 当前配置仍需原 verify 的真实 read-back。
- B：服务 journal retention、Supabase physical backup/PITR plan 的当前配置，由执行 Issue 记录授权与低敏回读证据。
- A：反馈、报名草稿/联系方式及 Demo 原始数据按上述业务用途保留；pending 教育材料保留至审核结束，再执行既有七天清理。无新增定期 purge 任务。
- C：通用账号删除后的 provenance/官方历史匿名化范围；此项属于独立产品边界。
- D 修复保留正式结论/历史：教育物理清理延迟不再允许新的到期证据读取/签名，删除仍只有原 retention owner。

本页不授权生产 purge，不宣称通用账号删除或所有 provider 的实时 retention 已验收。

比赛分图/完整回放与历史录像均属于公开赛事资料，由 postmatch owner 管理。`matches.recordings` 的解说归属、标题、链接随比赛保留；管理员可逐条移除，数据库备份仍遵循现有恢复保留期。导出 Preview 时排除该字段并使用空列表，原录像地址同样排除；不额外保存视频内容或建立外部抓取任务。

## Operator scoreboard receipts

OCR command receipts belong to the scoreboard persistence owner. They retain only
the actor/operation identifiers, map, operation kind, SHA256 input digest, base
and resulting content versions, result row count and database creation timestamp.
They retain no original image, submitted rows, credentials or request body.
Fresh season-admin recovery reads only the current actor and map; browser Data
API and Realtime have no grants or policies. Receipts live with their actor and
map and are removed by the existing foreign-key cascade when either parent is
actually deleted. No independent age-based purge is introduced: a missing receipt
is unconfirmed and never proves rollback or authorizes replay. Account merge
cleanup may remove an old actor's receipt; it does not transfer recovery authority
to another actor. Backups include receipts; restore requires the existing
database/cache consistency procedure and cannot treat missing acknowledgements
as proof that an earlier command did not commit.
