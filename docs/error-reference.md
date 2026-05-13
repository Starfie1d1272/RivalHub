# RivalHub 错误参考手册

## 阅读指南

本文档覆盖 RivalHub 所有用户可见的错误（50+ 条），按功能模块组织。每条错误包含：错误码、提示文案、触发条件、排查/恢复方法。

**通用架构**：
- Server Actions 返回 `fail({ code, message })` 或通过 `AppError` 抛异常 → `actionError()` 捕获转为 `fail`
- Zod 表单校验在客户端即时反馈，不经过服务端
- 页面级鉴权失败 → 重定向到登录页，不展示错误文案

---

## 一、登录 & 注册（Supabase Auth）

### 1.1 邮箱登录 (`src/actions/auth.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `VALIDATION_FAILED` | 请输入有效的邮箱地址 | 邮箱格式不合法 | 输入正确的邮箱格式 |
| `VALIDATION_FAILED` | 密码至少 6 位 | 密码不足 6 字符 | 输入 6 位以上密码 |
| `UNAUTHORIZED` | 邮箱或密码错误 | Supabase 认证失败（邮箱不存在或密码错误） | 核对邮箱和密码 |

### 1.2 邮箱注册 (`src/actions/auth.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `VALIDATION_FAILED` | 请输入有效的邮箱地址 | 邮箱格式不合法 | 输入正确的邮箱格式 |
| `VALIDATION_FAILED` | 密码至少 6 位 | 密码不足 6 字符 | 输入 6 位以上密码 |
| `VALIDATION_FAILED` | 注册失败，请确认信息后重试 | Supabase 注册失败（邮箱已注册等，不暴露具体原因） | 检查邮箱是否已注册 |
| `INTERNAL_ERROR` | 注册失败，请稍后重试 | Supabase 返回 data.user 为 null（服务异常） | 稍后重试 |

### 1.3 退出登录 (`src/components/layout/header-client.tsx`)

| 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|
| 退出失败，请重试 | Server Action 返回异常 | 刷新页面后重试 |

### 1.4 登录页面级重定向

| 页面 | 触发条件 | 行为 |
|---|---|---|
| `/login` | 已登录用户访问 | 重定向到首页 |
| `/invite` | 无 `rivalhub-session` cookie | 重定向到 `/login?next=/invite` |

---

## 二、邀请码

### 2.1 权限提升 — 已有账号使用邀请码 (`src/actions/auth.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `VALIDATION_FAILED` | 请输入邀请码 | 输入框为空或只有空白字符 | 输入 16 位十六进制邀请码 |
| `UNAUTHORIZED` | 请先登录 | 无 `rivalhub-session` cookie（页面级已重定向，正常不会触发） | 完成登录后返回 |
| `UNAUTHORIZED` | 邀请码无效 | 邀请码在数据库不存在（拼写错误、已被物理删除） | 核对邀请码是否正确 |
| `UNAUTHORIZED` | 邀请码已失效 | `isActive = false`（被创建者撤销或用完自动标记） | 联系管理员创建新邀请码 |
| `UNAUTHORIZED` | 邀请码已用完 | `usedCount >= maxUses` | 联系管理员创建新邀请码 |
| `UNAUTHORIZED` | 邀请码已过期 | `expiresAt` 已过当前时间 | 联系管理员创建新邀请码 |
| `VALIDATION_FAILED` | 赛季管理员邀请码缺少赛季范围 | 邀请码 `role=admin` 但 `seasonId` 为 null（数据异常） | 删除异常邀请码后重建 |
| `UNAUTHORIZED` | 账号不存在，请重新登录后重试 | cookie 中的 `userId` 在 `users` 表中不存在（典型场景：清库后 cookie 未过期） | 退出登录 → 重新登录 → 再使用邀请码 |
| `INTERNAL_ERROR` | 服务器内部错误，请稍后重试 | 事务提交后重建 session 时发生非预期异常 | 稍后重试 |

### 2.2 管理员注册 — 传统管理员使用邀请码注册 (`src/actions/admin.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `VALIDATION_FAILED` | 用户名至少 3 个字符 | 用户名为空或不足 3 字符 | 输入 3 字符以上用户名 |
| `VALIDATION_FAILED` | 密码至少 8 个字符 | 密码不足 8 字符 | 输入 8 字符以上密码 |
| `VALIDATION_FAILED` | 用户名已被使用 | `admin_users` 表中已存在同名用户 | 更换用户名 |
| `UNAUTHORIZED` | 邀请码无效 | 同 2.1 | 同 2.1 |
| `UNAUTHORIZED` | 邀请码已失效 | 同 2.1 | 同 2.1 |
| `UNAUTHORIZED` | 邀请码已用完 | 同 2.1 | 同 2.1 |
| `UNAUTHORIZED` | 邀请码已过期 | 同 2.1 | 同 2.1 |

### 2.3 创建/管理邀请码 (`src/actions/admin.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `VALIDATION_FAILED` | 请选择赛季范围 | 创建 admin 角色邀请码时未选赛季 | 选择目标赛季 |
| `SEASON_NOT_FOUND` | 赛季不存在 | 所选赛季 ID 在数据库不存在 | 刷新页面重新选择 |

---

## 三、管理员系统

### 3.1 管理员登录 (`/admin/login` — `src/actions/admin.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `VALIDATION_FAILED` | 请输入用户名和密码 | 用户名或密码为空 | 输入完整凭据 |
| `UNAUTHORIZED` | 用户名或密码错误 | 用户名不存在于 `admin_users` 表 | 核对用户名 |
| `UNAUTHORIZED` | 该账户已被停用 | `isActive = false` | 联系 super_admin 重新激活 |
| `UNAUTHORIZED` | 请使用 /login 的邮箱密码入口登录管理员账号 | 非 super_admin 角色尝试通过传统管理员页面登录（season_admin 不适用此入口） | 使用 `/login` 的 Supabase 邮箱密码入口 |
| `UNAUTHORIZED` | 用户名或密码错误 | 密码 hash 验证失败 | 核对密码 |

### 3.2 修改密码 (`/admin/settings` — `src/actions/admin.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `VALIDATION_FAILED` | 新密码至少 8 个字符 | 新密码不足 8 字符 | 输入 8 字符以上 |
| `FORBIDDEN` | 该页面仅支持修改 Root 紧急账号密码 | 非 root 来源尝试修改密码 | 使用 `/login` 入口修改 Supabase 密码 |
| `NOT_FOUND` | 管理员账户不存在 | `admin_users` 中找不到当前用户 | 重新登录 |
| `VALIDATION_FAILED` | 当前密码错误 | 旧密码验证失败 | 核对当前密码 |

### 3.3 停用管理员 (`src/actions/admin.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `VALIDATION_FAILED` | 不能停用自己的账户 | 操作者尝试停用自己 | — |
| `NOT_FOUND` | 管理员不存在 | 目标管理员 ID 不存在 | 刷新列表 |
| `FORBIDDEN` | 不能停用根管理员 | 目标是 `RivalHub_root` | — |

---

## 四、赛季管理

### 4.1 创建/编辑/发布/删除赛季 (`src/actions/seasons.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `VALIDATION_FAILED` | 赛季配置校验失败（附带字段错误） | Zod schema 验证失败 | 按字段提示修正 |
| `VALIDATION_FAILED` | stage key 重复: {key} | stages 配置中有重复的 key | 修改 key 使其唯一 |
| `SEASON_NOT_FOUND` | 赛季不存在 | 编辑/发布/删除时赛季 ID 不存在 | 刷新页面 |
| `VALIDATION_FAILED` | 编辑赛季时不能修改 slug | 尝试更改 slug | — |
| `SEASON_INVALID_STATUS` | 只有 draft 状态可修改核心赛季配置 | 非 draft 状态修改核心字段 | 仅在上线前（draft 状态）修改 |
| `SEASON_INVALID_STATUS` | 只有 draft 状态可发布 | 非 draft 状态尝试发布 | 赛季只能发布一次 |
| `SEASON_INVALID_STATUS` | 只有 draft 状态可删除 | 非 draft 状态尝试删除 | — |
| `SEASON_INVALID_STATUS` | 已有报名记录，不能删除赛季 | 已有选手报名 | 取消所有报名后再删除 |

### 4.2 Zod 字段校验（`src/actions/seasons.ts`）

| 字段 | 错误信息 |
|---|---|
| `name` | 请填写赛季名称 |
| `slug` | 请填写 slug / slug 只能使用小写字母、数字和连字符 |
| `kind` | 请填写赛事类型 |
| `starterCount` | 首发人数不能超过队伍上限 |
| `minTeamSize` | 最小人数不能超过最大人数 |
| `registrationDeadline` | 报名截止时间必须晚于报名开始时间 |

---

## 五、报名系统

### 5.1 草稿保存/加载 (`src/actions/register.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `VALIDATION_FAILED` | 草稿保存失败，请先填写有效邮箱（附带字段错误） | Zod 验证失败 | 按字段提示修正 |
| `VALIDATION_FAILED` | 请输入有效邮箱后再加载草稿 | 加载草稿前未填邮箱 | 先填写邮箱 |
| `SEASON_NOT_FOUND` | 赛季不存在 | 赛季 ID 不存在 | 检查 URL |
| `REGISTRATION_CLOSED` | （动态窗口提示，如"报名尚未开放"） | 当前不在报名时间窗口内 | 等待窗口开放 |

### 5.2 提交报名 (`src/actions/register.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `VALIDATION_FAILED` | 输入校验失败，请检查各字段（附带字段错误） | Zod schema 验证失败 | 按字段提示修正 |
| `SEASON_NOT_FOUND` | 赛季不存在 | 赛季 ID 不存在 | 检查 URL |
| `REGISTRATION_CLOSED` | （动态窗口提示） | 报名窗口未开放或已关闭 | 等待窗口开放 |
| `REGISTRATION_DUPLICATE` | 您已提交过报名 | 同一用户重复提交报名 | 查看已有报名状态 |
| `REGISTRATION_FULL` | 报名总人数已达上限 | 报名人数达到赛季上限 | 等待名额释放 |
| `POSITION_FULL` | 该位置主选名额已满 | 选定位置的名额已满 | 更换位置或等待释放 |

### 5.3 审核报名 (`src/actions/admin.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `VALIDATION_FAILED` | 无效的审核状态 | 目标审核状态不在合法范围内 | 检查操作合法性 |
| `NOT_FOUND` | 报名记录不存在 | 报名 ID 在数据库中不存在 | 刷新列表 |
| `POSITION_FULL` | 该位置主选名额已满 | 审核通过时位置已被占满 | 拒绝或等待其他报名释放位置 |

### 5.4 报名表单 Zod 校验（`src/lib/validators/registration.ts`）

| 字段 | 错误信息 |
|---|---|
| `email` | 请填写电子邮件 / 请输入有效的电子邮件地址 |
| `studentId` | 请填写学号（毕业生填「毕业年份+学院」） |
| `playerType` | 请选择允许的身份类型 |
| `qq` | 请填写 QQ 号 / 请输入有效的 QQ 号（5-12 位数字） |
| `perfectName` | 请填写完美平台昵称 |
| `steamName` | 请填写 Steam 昵称 |
| `steam64` | 请填写 Steam 64 位 ID / Steam64 ID 应为 17 位纯数字 |
| `steamProfileUrl` | 请填写 Steam 个人资料链接 / 请输入有效的链接 / 链接必须为 steamcommunity.com 域名 |
| `primaryPosition` | 请选择主选位置 |
| `secondaryPosition` | 请选择次选位置 / 次选位置不能与主选位置相同 |
| `peakRank` | 请选择历史最高段位 |
| `peakRankSeason` | 请填写取得最高段位的赛季（如 S1 2026） |
| `peakRating` | 请输入数字 / Rating 最小 0.01 / Rating 最大 3.00 / Rating 最多保留两位小数 |
| `peakWe` | 请输入数字 / WE 不能为负 / WE 最大 16.0 / WE 最多保留一位小数 |
| `currentSeasonPeakRank` | 请选择当前赛季最高段位 / 段位未达到报名资格 |
| `currentRating` | 请输入数字 / Rating 最小 0.01 / Rating 最大 3.00 / Rating 最多保留两位小数 |
| `currentWe` | 请输入数字 / WE 不能为负 / WE 最大 16.0 / WE 最多保留一位小数 |
| `screenshotUrls` | 请输入有效的链接 / 最多填写 N 个截图链接 |
| `gameplayStyle` | 请填写游戏风格自述 / 游戏风格自述不超过 100 字 |
| `competitionHistory` | 历史比赛经历不超过 500 字 |
| `highlightVideoUrl` | 请输入有效的链接（以 http:// 或 https:// 开头） |
| `notes` | 备注不超过 500 字 |
| `antiCheatPledge` | 请勾选反作弊承诺方可提交 |

---

## 六、队长投票

### 6.1 投票 (`src/actions/captains.ts` + `src/lib/captains/rules.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `NOT_FOUND` | 报名记录不存在 | 投票人或候选人的报名记录缺失 | 确认已通过审核 |
| `FORBIDDEN` | 权限不足 | 投票人 userId 与会话不匹配 | 检查登录状态 |
| `SEASON_NOT_FOUND` | 赛季不存在 | 赛季 ID 无效 | 检查 URL |
| `VOTING_CLOSED` | 投票通道未开放 | 赛季不在投票状态 | 等待投票开启 |
| `CAPTAIN_NOT_ELIGIBLE` | 该候选人不符合队长资格 | 候选人状态不是 approved 或不愿担任队长 | 确认候选人资格 |
| `FORBIDDEN` | 权限不足 | 投票人未通过审核 | 等待报名审核通过 |
| `VOTE_SELF` | 不能给自己投票 | 投票者和候选人是同一人 | — |
| `VOTE_LIMIT_REACHED` | 每人最多投 3 票 | 已投满 3 票 | 先撤回已有投票 |
| `VOTE_DUPLICATE` | 您已为该候选人投票 | 重复投票同一候选人 | — |

### 6.2 撤回投票 (`src/actions/captains.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `NOT_FOUND` | 报名记录不存在 | 投票记录不存在 | 刷新页面 |
| `FORBIDDEN` | 权限不足 | 撤回者与投票者不匹配 | — |
| `CAPTAIN_NOT_ELIGIBLE` | 该候选人不符合队长资格 | 赛季 ID 不匹配 | — |
| `VOTING_CLOSED` | 投票通道未开放 | 赛季已不在投票状态 | — |

### 6.3 确认队长 (`src/actions/captains.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `SEASON_NOT_FOUND` | 赛季不存在 | 赛季 ID 无效 | 检查 URL |
| `SEASON_CAPABILITY_DISABLED` | 该赛事未启用此功能 | 赛季未启用投票或选秀 | 检查赛季配置 |
| `SEASON_INVALID_STATUS` | 赛季当前状态不允许此操作 | 赛季不在投票状态 | 等待投票阶段 |
| `VALIDATION_FAILED` | 该赛季已生成队伍 | 队伍已存在，不能重复确认 | — |
| `CAPTAIN_NOT_ELIGIBLE` | 至少需要 N 名已通过且愿意担任队长的候选人，当前 M 名 | 合格候选人不足 | 等待更多候选人通过审核 |

---

## 七、选秀

### 7.1 选秀状态管理 (`src/actions/draft/state.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `SEASON_NOT_FOUND` | 赛季不存在 | 赛季 ID 无效 | 检查 URL |
| `SEASON_CAPABILITY_DISABLED` | 该赛事未启用此功能 | 赛季未启用选秀 | 检查赛季配置 |
| `SEASON_INVALID_STATUS` | 只有 drafting 状态的赛季可以启动选秀 | 赛季状态不符合 | 先发布赛季 |
| `SEASON_INVALID_STATUS` | 选秀已启动 | 重复启动 | — |
| `VALIDATION_FAILED` | 该赛季没有队伍，请先确认队长生成队伍 | 队伍数为 0 | 先确认队长 |
| `VALIDATION_FAILED` | 选秀需要 N 支队伍，当前为 M 支 | 队伍数量不正确 | 检查队伍配置 |
| `VALIDATION_FAILED` | 队伍 draft order 必须为 1-N 且不能重复 | 队伍选秀顺序配置异常 | 修复队伍 draftOrder |
| `DRAFT_NOT_ACTIVE` | 选秀未进行中 | 暂停/恢复时选秀不存在 | — |
| `DRAFT_NOT_ACTIVE` | 选秀未在进行中 | 暂停时选秀已停止 | — |
| `DRAFT_NOT_ACTIVE` | 选秀已在进行中 | 恢复时选秀已在运行 | — |
| `DRAFT_NOT_ACTIVE` | 选秀状态异常 | 恢复时无 currentTeamId | 联系管理员 |

### 7.2 执行选秀 (`src/actions/draft/picks.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `SEASON_NOT_FOUND` | 赛季不存在 | 赛季 ID 无效 | 检查 URL |
| `SEASON_CAPABILITY_DISABLED` | 该赛事未启用此功能 | 赛季无选秀能力 | 检查赛季配置 |
| `SEASON_INVALID_STATUS` | 只有 drafting 状态的赛季可以进行选秀 | 赛季状态不符 | — |
| `DRAFT_NOT_ACTIVE` | 选秀未进行中 | draftState 不存在或 !isActive | 等待管理员启动 |
| `VALIDATION_FAILED` | clientRequestId 已被其他 pick 使用 | 幂等性冲突 | 刷新页面重新选择 |
| `DRAFT_NOT_YOUR_TURN` | 当前轮次不是您的队伍 | 不是当前选秀队伍的队长 | 等待轮到自己 |
| `NOT_FOUND` | 队伍不存在 | 队伍 ID 无效 | 刷新页面 |
| `FORBIDDEN` | 只有当前轮次队长可以选择选手 | userId 不匹配队长 | — |
| `PLAYER_ALREADY_PICKED` | 队长已在该队伍中 | 选择了队长自身 | 选择其他选手 |
| `NOT_FOUND` | 目标选手不存在 | 选手 ID 无效 | 刷新页面 |
| `VALIDATION_FAILED` | 只能选择已通过审核的选手 | 选手状态不是 approved | 选择已通过审核的选手 |
| `PLAYER_ALREADY_PICKED` | 该选手已被选走 | 选手已被其他队伍选走 | 选择其他选手 |
| `TEAM_POSITION_CAP_EXCEEDED` | 该位置在本队已达 2 人上限 | 同位置选手超过 2 人 | 选择其他位置的选手 |
| `DRAFT_DEADLINE_PASSED` | 本轮选择时间已过 | 选秀轮次超时 | 等待自动 pick 或管理员干预 |
| `DRAFT_DEADLINE_PASSED` | 当前轮次尚未超时 | 截止时间后策略检查——当前轮次还没到截止时间 | — |

### 7.3 跳过/自动 pick (`src/actions/draft/picks.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `SEASON_NOT_FOUND` | 赛季不存在 | 赛季 ID 无效 | 检查 URL |
| `SEASON_INVALID_STATUS` | 只有 drafting 状态的赛季可以跳过轮次 | 赛季状态不符 | — |
| `DRAFT_NOT_ACTIVE` | 选秀未进行中 | 选秀未激活 | 等待管理员启动 |

---

## 八、赛程管理

### 8.1 生成赛程 (`src/actions/matches/schedule.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `SEASON_INVALID_STATUS` | 只有在赛季进行中才能生成赛程 | 赛季不在 playing 状态 | 先发布赛季 |
| `SEASON_INVALID_STATUS` | 赛程已生成，不可重复生成 | 已有比赛记录 | 使用已有赛程 |
| `VALIDATION_FAILED` | 队伍数量不足，无法生成赛程 | 队伍不足 2 支 | 确认至少 2 支队伍 |
| `SEASON_CAPABILITY_DISABLED` | 该赛季没有可生成的赛程阶段 | 赛季无 stage 配置 | 检查赛季配置 |

### 8.2 初始化阶段 (`src/actions/matches/schedule.ts` + 各赛制 executor)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `SEASON_INVALID_STATUS` | 只有在赛季进行中才能初始化阶段 | 赛季不在 playing 状态 | — |
| `SEASON_CAPABILITY_DISABLED` | 该赛季没有这个赛程阶段 | 阶段在配置中不存在 | 检查赛季配置 |
| `SEASON_INVALID_STATUS` | 首个阶段请使用一键生成赛程 | 第一个阶段的手动初始化 | 使用"一键生成赛程" |
| `SEASON_INVALID_STATUS` | {阶段名} 尚未全部结束，无法初始化 {阶段名} | 前一个阶段还有比赛未完成 | 完成所有比赛后重试 |
| `SEASON_INVALID_STATUS` | {阶段名} 已生成，不可重复生成 | 阶段已有比赛 | — |
| `VALIDATION_FAILED` | {阶段名} 预期 N 队，实际 M 队：{详情} | 晋级队伍数不匹配 | 检查晋级逻辑 |
| `SEASON_CAPABILITY_DISABLED` | 该赛季没有淘汰赛阶段 | 生成季后赛时无 playoff 阶段 | 检查赛季配置 |

### 8.3 赛制执行器错误

**瑞士轮** (`src/lib/formats/swiss.ts`)：

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `VALIDATION_FAILED` | 瑞士轮需要 N 个种子，当前种子数为 M | 种子配置与队伍数不匹配 | 检查种子配置 |
| `DRAFT_NOT_ACTIVE` | 瑞士轮尚未初始化 | 无比赛记录 | 先初始化 |
| `SEASON_INVALID_STATUS` | 第 N 轮还有 M 场比赛未结束 | 前一轮比赛未完成 | 完成所有比赛 |
| `VALIDATION_FAILED` | 第 N 轮比赛 {id} 比分未录入 | 比分缺失 | 录入所有比分 |
| `VALIDATION_FAILED` | 第 N 轮比赛 {id} 出现平局，瑞士轮不允许平局 | 比赛平局 | 修改比分 |
| `VALIDATION_FAILED` | 无法为 {teamId} 配对：所有同战绩候选均已交手 | 无可配对对手 | 检查赛事规模配置 |

**GSL 小组** (`src/lib/formats/gsl-group.ts`)：

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `VALIDATION_FAILED` | GSL 组仅支持 4 或 8 队/组，当前 N 队/组 | 每组成员数不正确 | 调整队伍分组 |
| `VALIDATION_FAILED` | 该阶段无比赛，请先初始化 | 未初始化 | 先初始化 |
| `VALIDATION_FAILED` | GSL 最多 4 轮 | 超出最大轮数 | — |
| `VALIDATION_FAILED` | 第 N 轮还有 M 场比赛未完成 | 前一轮未完成 | 等待比赛完成 |

**单败/双败淘汰** (`src/lib/formats/single-elim.ts`, `double-elim.ts`)：

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `SEASON_NOT_FOUND` | 赛季不存在 | 赛季 ID 无效 | 检查 URL |
| `SEASON_INVALID_STATUS` | 请先一键生成赛程 | 无 bracketData | 先使用一键生成赛程 |
| `SEASON_INVALID_STATUS` | {阶段名} 尚未全部结束 | 前序阶段未完成 | 等待比赛完成 |

**循环赛** (`src/lib/formats/round-robin.ts`)：

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `SEASON_NOT_FOUND` | 赛季不存在 | 赛季 ID 无效 | 检查 URL |

**未知赛制** (`src/lib/formats/index.ts`)：

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `INTERNAL_ERROR` | 未知赛制: {type} | StageType 未被任何 executor 注册 | 检查赛季 stage 配置 |

### 8.4 手动创建比赛 (`src/actions/matches/schedule.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `VALIDATION_FAILED` | 双方队伍不能相同 | 同一队伍 vs 自己 | 选择不同队伍 |
| `VALIDATION_FAILED` | 未知赛程阶段 | 阶段 key 无效 | 检查配置 |
| `VALIDATION_FAILED` | {阶段名} 只能是 BO1 | 循环赛/瑞士轮阶段尝试创建非 BO1 比赛 | — |
| `VALIDATION_FAILED` | 队伍不属于该赛季 | 选中的队伍不在当前赛季 | 选择正确的队伍 |

---

## 九、比赛操作

### 9.1 比分录入 (直接录入 — `src/actions/matches/results.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `MATCH_INVALID_SCORE` | 比分必须为非负整数 | 比分为负数或非整数 | 输入合法的非负整数 |
| `MATCH_INVALID_SCORE` | 系列赛不能平局，必须分出胜负 | 双方比分相同 | 修改比分 |
| `MATCH_INVALID_SCORE` | {format} 系列赛比分不合法（胜者须恰好赢 N 图） | BO3 比分不是 2:0/2:1 等 | 按格式要求录入 |

### 9.2 逐图录入 (`src/actions/matches/results.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `MATCH_INVALID_SCORE` | 比分必须为非负整数 | 非负整数验证 | 输入合法比分 |
| `MATCH_INVALID_SCORE` | 单图不能平局 | 单图比分相同 | 修改比分 |
| `VALIDATION_FAILED` | BO1 请使用直接录入比分功能 | BO1 比赛使用逐图模式 | 切换到直接录入 |
| `MATCH_INVALID_TRANSITION` | 比赛未在进行中 | 比赛不是 live 状态 | 先开始比赛 |
| `VALIDATION_FAILED` | {format} 图序号须在 1-{maxMaps} 之间 | 图序号超出范围 | 检查图序号 |
| `VALIDATION_FAILED` | 地图 {mapName} 在本场比赛中已存在 | 同一地图录入两次 | 选择不同地图 |

### 9.3 名单提交 (`src/actions/matches/roster.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `VALIDATION_FAILED` | 比赛状态不允许提交名单 | 比赛不在允许的状态 | 等待比赛进入可用状态 |
| `FORBIDDEN` | 只有队长可以提交名单 | 非队长用户 | 联系队长提交 |
| `VALIDATION_FAILED` | 必须选择 5 名首发 | 首发不足 5 人 | 选择 5 名首发 |
| `VALIDATION_FAILED` | 替补不能超过 2 人 | 替补超过 2 人 | 减少替补数量 |
| `VALIDATION_FAILED` | 队员不属于本队 | 选择的队员不是本队成员 | 选择本队队员 |
| `VALIDATION_FAILED` | 距开赛不足 2 小时，无法提交名单 | 距离开赛时间不足 2 小时 | 联系管理员解锁 |
| `VALIDATION_FAILED` | 名单已锁定，联系管理员解锁 | 已提交过名单 | 联系管理员 |

### 9.4 名单解锁 (管理员 — `src/actions/matches/roster.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `NOT_FOUND` | 目标不存在 | 名单记录不存在 | 刷新页面 |

### 9.5 比赛时间操作 (`src/actions/matches/results.ts` + `scheduling.ts`)

**修改比赛时间 / 最晚完成时间**：

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `MATCH_INVALID_TRANSITION` | 已结束或已取消的比赛不能修改时间 | 比赛已结束或取消 | — |
| `MATCH_INVALID_TRANSITION` | 已结束或已取消的比赛不能修改最晚完成时间 | 同前 | — |
| `VALIDATION_FAILED` | 最晚完成时间必须晚于当前时间 | 设为过去的时间 | 选择未来时间 |
| `VALIDATION_FAILED` | 最晚完成时间不能早于已设定的比赛时间 | completionDeadline < scheduledAt | 选择晚于比赛时间的日期 |

**时间协商** (`src/actions/matches/scheduling.ts`)：

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `VALIDATION_FAILED` | 只能在 scheduled 状态下提议时间 | 比赛不在 scheduled 状态 | — |
| `FORBIDDEN` | 只有队长可以提议时间 | 非队长用户 | 联系队长 |
| `NOT_FOUND` | 提议不存在 | 提议 ID 无效 | 刷新页面 |
| `VALIDATION_FAILED` | 提议已失效 | 提议已非 pending 状态 | — |
| `FORBIDDEN` | 不能回应自己的提议 | 回应人 = 提议人 | — |
| `FORBIDDEN` | 只有对方队长可以回应 | 非对方队长 | — |
| `VALIDATION_FAILED` | 拒绝时必须填写原因 | 拒绝时无拒绝原因 | 填写拒绝原因 |
| `VALIDATION_FAILED` | 时间协商已截止，请联系管理员指定比赛时间 | 超过协商截止时间 | 联系管理员 |
| `VALIDATION_FAILED` | 请输入有效的比赛时间 | 日期格式无效 | 选择有效日期 |
| `VALIDATION_FAILED` | 比赛时间必须晚于当前时间 | 选择过去时间 | 选择未来时间 |
| `VALIDATION_FAILED` | 比赛时间不能晚于最晚完成时间 | 提议时间超出 deadline | 选择更早的时间 |

### 9.6 客户端比分验证

**直接录入** (`src/components/matches/ScoreInput.tsx`)：

| 提示文案 | 触发条件 |
|---|---|
| 请输入有效的非负整数 | 输入 NaN 或负数 |
| 系列赛不能平局 | 双方比分相等 |
| {format} 比分不合法（胜者须恰好赢 N 图） | 不符合系列赛格式 |

**逐图录入** (`src/components/matches/MapByMapInput.tsx`)：

| 提示文案 | 触发条件 |
|---|---|
| 请选择地图 | 未选择地图 |
| 请输入有效的非负整数 | 输入 NaN 或负数 |
| 单图不能平局 | 双方比分相等 |

---

## 十、选手数据 & OCR

### 10.1 截图 OCR (`src/actions/player-stats.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `NOT_FOUND` | 地图记录不存在 | 匹配地图时未找到对应地图 | 检查数据完整性 |
| `NOT_FOUND` | 比赛记录不存在 | 匹配比赛时未找到对应比赛 | 检查数据完整性 |
| `INTERNAL_ERROR` | OCR 识别失败，请检查截图格式后重试 | OCR 处理异常 | 确认截图清晰度、格式正确 |

### 10.2 MVP 投票 (`src/actions/player-stats.ts`)

| 错误码 | 提示文案 | 触发条件 | 恢复方法 |
|---|---|---|---|
| `UNAUTHORIZED` | 请先登录 | 未认证用户 | 登录 |
| `MATCH_INVALID_TRANSITION` | 比赛尚未结束 | 比赛未结束即投票 | 等待比赛结束 |
| `MATCH_NOT_FOUND` | 比赛不存在 | 比赛 ID 无效 | 检查 URL |
| `VOTE_DUPLICATE` | 您已为本场比赛投过 MVP 票 | 重复投票 | — |
| `INTERNAL_ERROR` | 服务器内部错误，请稍后重试 | 未知异常 | 稍后重试 |

---

## 十一、页面级错误（Server Components + UI 组件）

### 11.1 `notFound()` — Next.js 404 页面

触发条件：`[seasonSlug]` 下所有页面的赛季查询返回 null、match/team/player 等实体查询返回 null。

涉及页面：`/`, `/[seasonSlug]/draft`, `/[seasonSlug]/captains`, `/[seasonSlug]/matches`, `/[seasonSlug]/teams`, `/[seasonSlug]/register`, `/[seasonSlug]/stats`, `/players/[userId]`, `/admin/*`

### 11.2 鉴权重定向（Server Component 层）

| 页面 | 触发条件 | 行为 |
|---|---|---|
| `/admin/*` (除 `/admin/login`) | 无管理员会话 | `checkAdminSession()` 返回 null → 重定向到 `/admin/login` |
| `/admin/invites` | 非 super_admin | `requireSuperAdmin()` 抛异常 → 重定向到 `/admin/login` |
| `/invite` | 无 `rivalhub-session` | 重定向到 `/login?next=/invite` |

### 11.3 EmptyState / UnavailablePanel

| 组件 | 页面 | 触发条件 |
|---|---|---|
| `EmptyState` | 首页 | 无进行中的赛季 — "暂无进行中的赛季" |
| `UnavailablePanel` | `/[seasonSlug]/draft/captain` | 赛季未启用选秀 — "该赛季未启用蛇形选秀。" |
| `UnavailablePanel` | `/[seasonSlug]/draft/captain` | 不在选秀阶段 — "当前不在选秀阶段，队长面板暂不可用。" |
| `UnavailablePanel` | `/[seasonSlug]/draft/captain` | 未登录 — "请先登录队长账号后再进入选人面板。" |

### 11.4 ErrorState 组件

通用错误回退组件，默认展示 code="ERR_500" + "出错了"，支持 `onRetry` 重试回调。用于捕获无法恢复的渲染错误。

---

## 十二、用户错误恢复矩阵

按用户感知到的现象排序：

| 用户看到的现象 | 可能的原因 | 排查顺序 |
|---|---|---|
| "请先登录" | 未登录或 cookie 过期 | 重新登录 |
| "权限不足" / 重定向到登录页 | 角色不匹配（普通用户访问管理后台，season_admin 跨赛季操作） | 确认当前账号角色和权限范围 |
| "服务器内部错误" | 数据库连接中断、Supabase 异常、非预期代码异常 | 1. 检查网络 2. 检查 Vercel/DB 服务状态 3. 稍后重试 |
| "赛季不存在" / 404 | URL slug 错误或赛季已删除 | 检查 URL，确认赛季是否存在 |
| "赛季当前状态不允许此操作" | 操作与当前赛季阶段不匹配 | 查看赛季状态后确认可用操作 |
| "该赛事未启用此功能" | 赛季 capability 未开启（如无选秀、无投票） | 检查赛季配置 |
| "输入校验失败" + 字段错误 | Zod schema 校验失败 | 按每个字段的红色提示修正 |
| 表单字段红色提示 | 字段级客户端 Zod 验证 | 按要求重新填写 |
| "报名通道未开放" | 当前时间不在 `startAt`~`registrationDeadline` 窗口内 | 核对报名时间段 |
| "该位置主选名额已满" | 报名该位置的 approved 人数已达上限 | 换位置或等待释放 |
| "报名总人数已达上限" | 赛季报名人数已满 | 等待名额释放 |
| "选秀未进行中" / 队长面板不可用 | 不在选秀阶段 | 等待选秀开始 |
| "当前轮次不是您的队伍" | 选秀顺序未到你 | 等待轮到自己 |
| "该选手已被选走" | 选手已被其他队选中 | 选择其他选手 |
| **"账号不存在，请重新登录后重试"** | **cookie 有效但 DB 中用户不存在（清库后典型现象）** | **退出 → 重新登录** |
| **"服务器内部错误" → "邀请码已失效"（连续两次）** | **（已修复）清库后旧 cookie 使用邀请码** | **退出 → 重新登录 → 使用新邀请码** |
| 提交名单被拒 | 距开赛不足 2 小时 / 名单已锁定 / 非队长 | 联系管理员手动操作 |
| "时间协商已截止" | 超过协商窗口 | 联系管理员强制设定比赛时间 |
| "OCR 识别失败" | 截图格式或清晰度不满足 | 重新截图，检查格式 |
| 投票无响应 | 未通过审核 / 投票已关闭 / 已达 3 票上限 | 逐一排查限制条件 |

---

## 十三、架构说明

1. **Server Action → `fail({ code, message })`**：所有用户可见错误的标准出口。`code` 是 `ErrorCode` 枚举值，`message` 是中文提示。
2. **`AppError` 抛出 → `actionError()` 捕获**：在工具函数中抛出的错误由 Server Action 的 catch 块统一处理，自动转为 `fail`。
3. **Zod 校验 → 客户端即时反馈**：表单 schema 定义在 `src/lib/validators/` 和 `src/actions/` 中，通过 React Hook Form 的 `formState.errors` 直接渲染每个字段的错误信息，不经过 toast。
4. **`notFound()` → Next.js 404**：Server Component 在查询返回 null 时调用，触发框架级 404 页面。
5. **鉴权失败 → 重定向**：`requireAuth()` / `requireAdmin()` 等抛出 `AppError`，页面级 try-catch 捕获后执行 redirect。
6. **客户端输入验证 → 内联 `toast.error()`**：简单的格式校验（如比分合法性）在客户端组件内部直接验证并 toast 提示，不发起服务端请求。
