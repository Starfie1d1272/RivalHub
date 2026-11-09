# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

办赛方与参赛者是同等优先的核心用户。

- 办赛方组织高校 CS2 赛事。赛事管理员负责审核、开赛准备、阶段推进和异常处理，裁判在单场比赛中核对首发、BP 和赛果。
- 参赛者维护个人资料和参赛资格，按本届赛制报名并完成比赛。队长还要组织成员确认、提交名单和协调比赛时间。
- 观众查看公开赛程、比分、晋级和历史数据，也可参与适用赛事的模拟与预测。

## Product Purpose

RivalHub 是面向高校 CS2 赛事的开源 Web 平台，目前主要服务 NJU Rivals 和 NJU Major。办赛方能在同一平台完成从报名到赛季收尾的工作，参赛者能确认自己在当届赛事的状态并完成待办。赛后的正式结果继续沉淀为可查询的选手、队伍与赛事历史。[项目介绍](README.md)

## Positioning

RivalHub 用同一套账号、比赛和统计基础承载两种参赛路径。Rivals 通过个人报名、队长投票与选秀形成当届参赛队；Major 由长期队伍报名，经过成员确认、资格审核和赛前锁定，再进入 Swiss 与 Playoffs。选手资料与长期队伍可跨赛事复用，每届保有自己的参赛名单和比赛记录。[赛事工作流](docs/workflows.md) · [领域模型](docs/domain-model.md)

## Operating Context

参赛者围绕报名窗口、成员确认、名单调整和比赛排期处理待办。办赛方在赛前工作区推进审核、资格赛与开赛准备，再通过比赛工作台处理首发、BP、逐图赛果与更正。对局在 Perfect World 完成，建房和现场协调由赛务人员处理，Mizar 与 OBS 承担现场数据和转播制作的相应工作。[赛事工作流](docs/workflows.md) · [裁判与管理员手册](docs/operations/major-referee-guide.md)

## Capabilities and Constraints

- 长期队伍、当届参赛名单和单场首发分别记录。赛事发布、开放报名、冻结名单和开赛是各自独立的业务状态或操作。[领域模型](docs/domain-model.md) · [赛事生命周期](docs/workflows.md#season-lifecycle)
- 赛事管理权限按赛事授予。公开赛况、个人待办和管理员审核材料分别按各自的权限范围提供。[鉴权与权限](docs/auth-and-permissions.md#authorization)
- 模拟与预测读取正式赛况。晋级、种子、赛果和名次由赛事流程确认。[观赛预测工作流](docs/workflows.md#spectator-predictions)
- 当前办赛支持以官方实例为主。独立实例的产品方向和支持边界由路线图维护。[产品路线图](docs/roadmap.md)

## Brand Commitments

产品名写作 RivalHub，沿用仓库中的标志与字标。操作指引和异常提示用自然中文说明当前状态及下一步，保留 CS2、Major、Swiss、BP、BO3 等熟悉的专业术语。[品牌资源](public/brand/rivalhub/README.md) · [产品语言](docs/ui-system.md#product-language)

## Evidence on Hand

2026 NJU Rivals 已使用 RivalHub 跑完从报名和选秀到比赛、统计与赛季收尾的完整流程。仓库留有赛事首页、双败淘汰赛和赛季排行榜的截图。[赛事记录与截图](README.md#rivals-与-major)

## Product Principles

1. 让办赛和参赛双方都知道接下来该做什么。显示当届状态、待处理事项和适用的截止时间，遇到阻塞时说明原因及处理入口。
2. 为日常自助和赛务例外提供明确的路径。参赛者维护资料、确认和提交名单，办赛方处理审核、裁决、更正与恢复并保留记录。
3. 让历史可复查。历史名单和赛果按当届已确认或经授权更正的记录呈现，赛后统计保留数据来源和适用范围。

## Accessibility & Inclusion

关键流程须在 320–390 px 的窄屏上可完成。操作须支持键盘并提供可见焦点，状态须有颜色之外的可读提示，动效遵循 `prefers-reduced-motion`。[响应式与无障碍约定](docs/ui-system.md#responsive-and-accessibility)
