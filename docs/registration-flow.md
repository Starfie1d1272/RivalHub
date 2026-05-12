# 报名流程

## 完整流程图

```
用户访问 /[seasonSlug]/register
  ↓
检查赛季状态是否为 registration（Server Component fetch）
  ├── 否（已截止 / 未开放） → 显示"报名未开放"提示
  └── 是 → 渲染报名表单（赛季发布后可见）
        ↓
        根据时间窗口计算操作权限：
          - now < startAt：可保存草稿，不可正式提交
          - startAt <= now < registrationDeadline：可保存草稿，可正式提交
          - now >= registrationDeadline：草稿和提交均关闭
        ↓
        展示各位置已报名人数（页面加载时静态渲染，提交后服务端二次校验）
        ↓
用户填写表单（含 NJUBox 截图分享链接）
  ↓
保存草稿：只要求 seasonId + email，写入 registration_drafts，不占名额、不进入审核
  或
正式提交：客户端 Zod 校验通过
  ↓
调用 submitRegistration Server Action
  ↓
服务端 Zod 二次校验
  ↓
检查位置是否已满（COUNT GROUP BY）
  ├── 已满 → 返回错误"该位置已满员"
  └── 未满 → INSERT season_registrations（status=pending）
              ↓
              不发送登录邮件；选手通过 /login 使用邮箱+密码登录
              ↓
              返回成功 → 页面跳转"报名成功"
```

---

## 时间语义

- `seasons.status = registration`：赛季已发布，赛季页和报名页对外可见。
- `seasons.startAt`：报名提交开放时间。为空时表示发布后立即可提交。
- `seasons.registrationDeadline`：报名提交截止时间。为空时表示不设截止。
- `seasons.endAt`：赛季结束时间，仅用于展示/归档，不控制报名窗口。

报名表单在 `registration` 状态下始终可浏览。正式提交必须满足 `startAt <= now < registrationDeadline`；开始前可以保存草稿，截止后草稿保存和正式提交都关闭。

---

## 草稿与正式报名

草稿独立存储在 `registration_drafts`：

- 唯一键：`(season_id, email)`，重复保存会覆盖旧草稿。
- `payload` 保存表单快照，不执行完整报名校验。
- 草稿不写入 `season_registrations`，不占总人数/位置名额，不进入管理员审核。
- 正式提交成功后删除同 `season_id + email` 的草稿。

正式报名仍写入 `season_registrations(status = pending)`，并执行完整 Zod 校验、重复报名检查、总人数上限和位置上限检查。

---

## 截图上传

**当前方案（v1）**：选手将近两周 5 场天梯截图上传至 NJUBox（https://box.nju.edu.cn），获取 1 个分享链接后填入报名表单的「NJUBox 分享链接」字段。提交时直接存储该 URL。`registrationConfig.screenshotCount` 控制链接字段数量，Rivals 默认 1 个链接。

**未来方案**：支持客户端直传 Supabase Storage，避免依赖第三方图床。
- Bucket 名称：`registration-screenshots`
- 权限：私有（不公开访问）
- 管理员审核时通过 Service Role 生成签名 URL（有效期 1 小时）

---

## 总人数上限

除位置满员检测外，赛季还有全局报名人数上限（`registrationConfig.maxTotal`，默认 56 人）。到达后新报名被拒绝，返回"报名总人数已达上限"。

---
  
## 位置满员检测

### 前端展示（不使用 Realtime）

`season_registrations` 不在 Realtime 订阅白名单内（见 `docs/architecture.md`「Realtime 订阅范围」）。位置已报名人数仅在页面加载时由 Server Component 查询并静态渲染——满员状态以"提交时服务端二次校验 + 提交失败时 Toast 提示"为最终拦截层，不依赖前端推送。

```tsx
// app/[seasonSlug]/register/page.tsx (Server Component)
const counts = await db
  .select({ position: registrations.primaryPosition, count: count() })
  .from(registrations)
  .where(and(
    eq(registrations.seasonId, season.id),
    inArray(registrations.status, ["pending", "approved"]),
  ))
  .groupBy(registrations.primaryPosition);
// 传入 Client 表单组件做 disabled 渲染
```

报名提交后调用 `revalidatePath(\`/\${seasonSlug}/register\`)` 让下一次访问拿到最新计数。

### 满员判断（后端）

```sql
SELECT primary_position, COUNT(*) as count
FROM season_registrations
WHERE season_id = $1 AND status IN ('pending', 'approved')
GROUP BY primary_position;
-- count >= 15 则该位置关闭
```

**注意**：待审核（pending）+ 已通过（approved）均计入位置上限，防止超量报名后批量通过。

---

## 表单字段说明

### 必填字段

| 字段 | 说明 | 校验规则 |
|---|---|---|
| `email` | 邮箱（用于登录） | 有效 email 格式 |
| `studentId` | 学号 | 非空；毕业生填「毕业年份+学院」 |
| `qq` | QQ 号 | 5-12 位数字 |
| `perfectName` | 完美平台昵称（记分板显示名） | 非空 |
| `steamName` | Steam 昵称 | 非空 |
| `steam64` | Steam 64 位 ID | 17 位纯数字 |
| `steamProfileUrl` | Steam 个人资料链接 | steamcommunity.com 域名 |
| `primaryPosition` | 主选位置 | `season.positions` 中的合法值 |
| `secondaryPosition` | 次选位置 | 不可与主选相同 |
| `peakRank` | 历史最高段位 | 合法段位值（D~S魔王） |
| `peakRankSeason` | 取得最高段位的赛季 | 非空，如 "S1 2026" |
| `peakRating` | 历史最高完美平台 Rating | 0.01–3.00，两位小数（均值约 1.0） |
| `currentSeasonPeakRank` | 当前赛季最高段位 | 合法段位值；**报名门槛见下** |
| `currentRating` | 当前赛季 Rating | 0.01–3.00，两位小数 |
| `screenshotUrls` | 天梯截图 NJUBox 分享链接数组 | Rivals 默认 1 个链接；链接内容需包含近两周 5 场截图 |
| `gameplayStyle` | 游戏风格自述 | ≤100 字 |
| `antiCheatPledge` | 反作弊承诺勾选 | 必须为 true |

### 报名段位门槛

**以下两个条件满足其一即可报名**（当前赛季最高段位 ≥ **A** 或历史最高段位 ≥ **A+**）：
- 在校生（`enrolled`）和毕业生（`graduated`）均可报名

校验在 Zod schema（客户端）和 Server Action（服务端）两层执行。

### 报名人数限制

- 总报名人数上限 `maxTotal`：默认 56 人（8 队 × 7 人/队），到达后新报名被拒绝
- 每位置上限 `maxPerPosition`：默认 15 人，由 Server Action COUNT GROUP BY 校验
- `allowedPlayerTypes`：允许的选手身份类型，默认 `["enrolled", "graduated"]`

### 选填字段

| 字段 | 说明 |
|---|---|
| `peakWe` | 历史最高 Win Effect，0.0–16.0，一位小数（均值约 8.0） |
| `currentWe` | 当前赛季 WE，同上 |
| `competitionHistory` | 历史比赛经历（≤500 字） |
| `highlightVideoUrl` | 高光视频链接 |
| `willingToBeCaptain` | 是否愿意担任队长（默认 false） |
| `notes` | 备注（≤500 字） |

---

## 用户认证流程

用户通过 `/login` 使用邮箱+密码注册或登录。生产环境关闭 Supabase 邮件确认，不依赖 Magic Link。

登录成功后：
1. Server Action 调用 Supabase Auth `signUp` 或 `signInWithPassword`
2. 同步 `public.users`，并用 `iron-session` 写入 `rivalhub-session`
3. 后续权限判断读取 `users.role` 与 `adminSeasonIds`

---

## 错误状态 UI

| 场景 | 提示 |
|---|---|
| 赛季不在报名阶段 | "报名通道未开放，请关注赛委会公告" |
| 报名提交尚未开放 | "报名提交尚未开放，可以先保存草稿" |
| 报名提交已截止 | "报名提交已截止" |
| 位置已满 | "该位置主选名额已满，可选择其他位置报名" |
| 已报名过 | "您已提交报名，请等待审核结果通知" |
| 截图链接无效 | "请输入有效的链接（以 http:// 或 https:// 开头）" |
| 总人数已满 | "报名总人数已达上限" |
| 提交失败（网络） | Toast 错误提示 + 允许重新提交（幂等）|
