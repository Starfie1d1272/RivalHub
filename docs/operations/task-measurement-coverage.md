# 非 OCR 任务接入与接线

Owner：C 维护生命周期合同及账号/报名调用者；D 负责 BET/预测，E 负责档案读取，F 负责公共页面，G 负责 BP/可靠恢复。逐 operation/显式浏览器入口清单见 [telemetry-task-entries.csv](telemetry-task-entries.csv)。注册表映射、observeAction 和 begin/complete 是三种不同证据；清单中的“已接起止”也不证明生产采到。

观察状态必须分开：**未接任务**是源码缺 begin/确认路径；**未采到开始**是已接但窗口没有 start（不能填成失败或 0%）；**进行中**是有 start 且未到窗口末；**成熟未完成**是窗口结束仍未观测到 complete；**完成**是同身份、会话、定义、token 的窗口内确认。明确 cancel、unknown 和孤立结果另列。内容浏览使用 ready，不虚构业务完成。只有操作记录的入口保留操作分母。

| 类别 | 入口与源码接入 | 状态证据/后续责任 |
|---|---|---|
| content | ContentReady、公共页面和档案主体/高级块 | ready 为主；无业务 start；F/E 接需求 token |
| login | LoginForm → auth.loginWithPassword | 显式 begin；原匿名 identity 同步确认并 flush/reset；新生产样本未采 |
| account | LoginForm 注册、ForgotPasswordForm、ResetPasswordForm、ChangePasswordForm、EmailConfirmationForm、SecondaryIdentityConfirmationForm、ClaimInviteForm | 显式提交与确认；邮件/报名结果呈现独立。备用邮箱请求/撤销、重发、会话撤销、归并等未接完整任务，CSV 单列 |
| profile | ProfileForm、CompetitiveProfileForm | 显式填写/提交/确认；位置/地图偏好仅操作，不能由同类页面推定已接 |
| education | EducationVerificationPanel | 本人显式教育提交有 task；审核/建机构仅操作；不将审核完成等同申请人任务完成 |
| teams | LongLivedTeamWorkspace、ClaimTeamInviteButton、LeaveTeamControl | 仅操作；未接完整任务 |
| registration | RegistrationForm | eligible exposure、输入/校验/提交/同步确认、成功界面 result；保存草稿不是完成 |
| team_registration | CompetitionEntryFlow | 保存名单为 edit、正式 submit 确认才 complete；邀请接受/撤回/审核等不能自动算本任务完成 |
| scheduling | MatchTimeNegotiation、ScheduledAtInput、BatchDeadlineCard | 仅操作；未接完整任务；双方等待不属于一次点击响应 |
| roster | MatchRosterForm；AdminRosterDialog | 本人提交有起止；后台代选等仅操作，不外推 |
| veto | VetoRoom；VetoInputDialog | VetoRoom 已有 begin/正常确认；G 用同 token 补 known-commit 恢复；stale 不成功、unknown 不重放，自动 BP 不是点击 |
| postmatch | MatchRecordingEditor、PostMatchRecordPanel、DemoDataReviewPanel、MatchResources | 仅操作；未接完整任务；业务齐备由原 read model 判断 |
| predictions | PredictionBoard | 保存草稿不完成，正式提交确认才完成；D 补 UI result 与其他预测入口 |
| bet | UnifiedBetBoard、BetBoard、BetOperations | 仅操作；D 按 join/stake 的实际业务目标接 begin/确认，不能把榜单浏览算下注 |
| awards | CommunityAwardsBoard/Submission/Evidence/AdminControls、CaptainVotingPanel、MatchMvpVote | 仅操作；未接完整任务；管理与投票目标分别定义 |
| recruitment | PlayerLftEditorDialog、TeamRecruitmentSection、RecruitmentInterestButton、InviteRecruitingPlayerButton | 仅操作；未接完整任务，不把回应等待混入调用耗时 |
| administration | admin、draft、比赛管理显式操作（逐项见 CSV） | 仅操作；未接完整任务；定时/自动流程不能生成浏览器点击 |

当前运行时观察状态需要读取相应版本与窗口的数据，本表不把源码状态伪装成生产“进行中/成熟/完成”。历史包 v2.24.1 的登录 1 次尝试/0 完成、BET 有调用无任务只属于原窗口；新代码不回填历史。本地测试只证明受控分支，不证明线上采集率。

## 调用合同

```ts
const task = useTelemetryTask("veto", matchId);
const captured = task.begin("submit");
// 调用一次业务 owner。仅明确确认同一操作后：
task.complete(captured);
// React 实际呈现对应结果后：
task.step("result", captured);
```

complete 同步、幂等，保留有界 terminal receipt 允许 result/ready；取消后的 token 不再呈现。异步路径必须传 captured token。旧 scope 不完成新 scope，卸载不伪造取消或成功；同类多 scope 时 observeAction 不擅自选一个任务。所有未决和 terminal token 合计最多 8 个；从 start 按任务窗口 TTL 淘汰，expired/capacity/forgotten/reset 原因仅留内存计数。身份/隐私重置清除所有 token；不持久化 name/scope/密码/表单原文。

登录仅在原 queue 和原捕获 attempt 下确认并 flush，随后 reset。换账号或 logout 后的旧异步成功不清空新账号 queue。result 不携带到另一个账号。

```ts
const demand = beginTelemetryDemand("player"); // 用户展开处理器中捕获
// 同一次需求的模块内容实际可用后：
recordDemandReady(demand, "advanced");
```

需求 token 为 memory-only 的 navigationId/module/单调 started；最多 32 个、1h TTL，跨导航/queue 身份或重复 ready 忽略。原 recordContentReady 继续保留 navigation 到首次 ready 与原始长尾；demand 不减去等待后覆写旧值。只有显式 native source URL、start、navigation kind 均匹配时，Web Vital 才复用导航 ID；否则其随机样本 ID 独立，关联未知。

本 PR 的新 wire emit 保持关闭：task-client 默认发 v1，v2 censored 分支仅用于合同测试；demand API 当前只发兼容的原 navigation ready，不发 basis。B 完成逐字段校验与按 version/basis 分组后，后继提交才启用。不能将类型合并、客户端代码存在或本地解析成功当作 receiver 已部署。

## 其他 owner 精确接线

- D：UnifiedBetBoard/BetBoard/BetOperations 用户提交前 begin，明确 receipt 后 complete；PredictionBoard 继续使用 captured token，结果状态实际呈现时 result。切 view 不复用另一个 scope。
- E：档案高级模块的用户展开处理器捕获 beginTelemetryDemand；实际 lazy 内容 mount 后 recordDemandReady。原导航 primary/advanced ready 保持，不修改共享统计口径。
- F：普通公共页面维持 navigation ready；确实由用户迟到请求的懒模块才接 demand。缺少 native source/start 的 Web Vital 保持未知关联。
- G：VetoRoom 保存 perform 命令 captured token；known-commit 恢复读确认**同一事实**后 complete，房间投影可见才 result。stale 是拒绝，unknown 不重发写入；claim/start/pause 等不能靠一个正常命令分支推定全部已接。

回退 core 时恢复旧客户端；新 wire 未启用时无需接收端回滚。已落地的旧业务权限、时钟、锁序、幂等和恢复 owner 均不变。
