# 外部试点 Readiness

本文档用于外部高校赛事方试点前判断 RivalHub 的真实可用边界。它不替代 `README.md`，也不把设计预设视为已生产可用能力。

## 总体判断

RivalHub 当前适合作为 NJU 选秀联赛流程的二开基础，也适合作为外部赛事方的受控试点基础。试点前必须先搭建独立 staging 环境，并把权限、seed 和文档边界处理清楚。

当前不适合直接承诺为完整商业 SaaS。队伍报名、Major 三段 Swiss、broadcast overlay、俱乐部体系、广告系统仍属于新增开发或未验收能力。

## 能力分层

| 分层 | 能力 | 状态 |
|---|---|---|
| 已实战验证 | 个人报名、审核、队长投票、选秀、排位赛、双败淘汰、基础比分录入、OCR 数据录入、公开赛程和基础统计 | 可作为 NJU 当前流程继续使用 |
| 已实现待验收 | demo ZIP 导入、批量匹配、OCR 冲突确认、覆盖导入、Steam alias、RR / PRISM 重算入口 | 可进 staging 验收，不直接承诺生产稳定 |
| 配置/代码基础存在 | Major preset、Swiss executor、single elimination handoff | 需要补多阶段运营 UI 和 staging 验收 |
| 尚未实现 | 队伍自助报名、队伍报名审核、自动生成队伍、broadcast API、OBS/vMix overlay、俱乐部体系、广告系统 | 需要单独立项 |

## 外部试点前必须完成

1. **文档事实化**
   - README 和 docs 只描述当前真实能力。
   - demo 展示、Major、队伍报名、broadcast 统一标注为待验收或新增。

2. **独立 staging**
   - Vercel staging / preview deployment。
   - 独立 Supabase 项目。
   - 独立 `DATABASE_URL`、Supabase URL、anon key、service role key、`ADMIN_SESSION_SECRET`、`CRON_SECRET`、OCR key。
   - staging 的 seed、E2E、demo 导入压测不得指向生产数据库。

3. **权限收敛**
   - map/match 级 demo、OCR、经济回填 action 应按 `match.seasonId` 调用 `requireSeasonAdmin(seasonId)`。
   - 外部 `season_admin` 只能操作授权赛季。

4. **试点 seed**
   - `seed:rivals`：个人报名、审核、队长投票、选秀、排位赛、双败。
   - `seed:permissions`：guest、user、season_admin、super_admin、root。
   - 后续再补 `seed:major`、`seed:broadcast`、`seed:demo`。

5. **最小 E2E**
   - 登录。
   - 个人报名。
   - 审核通过。
   - 确认队长。
   - 选秀 smoke。
   - 生成赛程。
   - 比分录入。
   - 权限越权 smoke。

## 暂不做但必须声明

| 能力 | 当前处理 |
|---|---|
| 队伍报名 | 暂不承诺；外部试点若需要队伍制，先由管理员手工建队或等待后续实现 |
| Major 三段 Swiss | 暂不承诺完整运营；当前仅有 preset 和 executor 基础 |
| Broadcast / OBS / vMix | 新增模块；需要另立 broadcast MVP |
| demo 高级展示 | 当前仓库保留导入和部分展示基础；完整分析展示由 `cs2-demo-analysis-kit` 完成后接入 |
| rival-rating 体系 | 当前保留接入和重算入口；权重、分析和发布流程由 `rival-rating` 仓库推进 |
| 俱乐部/广告系统 | 不属于试点前最小范围 |

## 建议整改顺序

1. 文档事实化。
2. 建 staging 环境文档和 seed 入口。
3. 修 demo/OCR/经济回填权限。
4. 补权限单测。
5. 补 staging smoke E2E。
6. 再评估是否进入队伍报名或 Major UI 实现。

## 试点验收口径

一次外部试点只能承诺以下结果：

- staging 环境可独立访问，不读写生产库。
- seed 数据可复现 NJU 选秀联赛核心路径。
- `season_admin` 无法跨赛季执行管理操作。
- README/docs 不再过度声明未验收能力。
- 当前 NJU 赛事线上流程不受影响。
