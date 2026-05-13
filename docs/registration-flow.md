# 报名流程

## 完整流程图

```
用户访问 /[seasonSlug]/register
  ↓
检查赛季状态是否为 registration（Server Component fetch）
  ├── 否（已截止 / 未开放） → 显示"报名未开放"提示
  └── 是 → 检查用户登录状态
            ├── 未登录 → redirect(`/login?next=/${seasonSlug}/register`)
            └── 已登录 → 渲染报名表单
        ↓
        根据时间窗口计算操作权限：
          - now < startAt：可保存草稿，不可正式提交
          - startAt <= now < registrationDeadline：可保存草稿，可正式提交
          - now >= registrationDeadline：草稿和提交均关闭
        ↓
        展示各位置已报名人数（页面加载时静态渲染，提交后服务端二次校验）
        ↓
用户填写表单（含地图偏好 + 可选 NJUBox 截图分享链接）
  ↓
保存草稿：只要求 seasonId + email，写入 registration_drafts，不占名额、不进入审核
  或
正式提交：客户端 Zod 校验通过
  ↓
调用 submitRegistration Server Action
  ↓
服务端 Zod 二次校验 + session 验证
  ↓
检查位置是否已满（COUNT GROUP BY）+ 总人数上限
  ├── 已满 → 返回错误"该位置已满员"或"报名总人数已达上限"
  └── 未满 → INSERT season_registrations（status=pending）
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

**当前方案（v1）**：选手可将近两周 5 场天梯截图上传至 NJUBox（https://box.nju.edu.cn），获取分享链接后填入报名表单的「NJUBox 分享链接」字段。该字段为选填；提交时会过滤空链接并直接存储有效 URL。`registrationConfig.screenshotCount` 控制最多展示/提交的链接数量，Rivals 默认最多 1 个链接。

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
| `email` | 邮箱（与登录邮箱一致，只读） | 有效 email 格式；必须与当前 session 邮箱一致 |
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
| `mapPreferences` | 当前赛季图池熟练度 | 每张图 1 个档位；至少 3 张达到「能打」；「强图」最多 3 张 |
| `gameplayStyle` | 游戏风格自述 | ≤100 字 |
| `antiCheatPledge` | 反作弊承诺勾选 | 必须为 true |

### 选填字段

| 字段 | 说明 | 校验规则 |
|---|---|---|
| `screenshotUrls` | 天梯截图 NJUBox 分享链接数组 | 最多 `registrationConfig.screenshotCount` 个；非空时必须为 http(s) 链接 |
| `competitionHistory` | 历史比赛经历 | ≤500 字 |
| `highlightVideoUrl` | 高光视频链接 | 非空时必须为 http(s) 链接 |
| `notes` | 备注 | ≤500 字 |

### 报名段位门槛

**以下两个条件满足其一即可报名**（当前赛季最高段位 ≥ **A** 或历史最高段位 ≥ **A+**）：
- 在校生（`enrolled`）和毕业生（`graduated`）均可报名

校验在 Zod schema（客户端）和 Server Action（服务端）两层执行。

### 地图熟练度

地图池来自 `registrationConfig.mapPool`，为空时回退到默认 CS2 图池：Mirage / Inferno / Nuke / Ancient / Dust2 / Anubis / Train。

选手需为当前赛季图池中的每张图选择一个档位：

| 档位 | 含义 |
|---|---|
| 不会 | 基本不打，不建议安排 |
| 认路 | 知道基本报点和默认，但不稳定 |
| 能打 | 可进入阵容安排，常规执行没问题 |
| 熟练 | 有主动打法和稳定发挥 |
| 强图 | 明显优势图，可作为队伍地图池核心 |

约束：
- 至少 3 张图达到「能打」及以上
- 「强图」最多 3 张
- 管理后台审核、队长选人、选秀直播间、队伍详情和选手页都会展示地图偏好

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

**报名前必须先登录。** 未登录用户访问报名页时自动 redirect 到 `/login?next=/${seasonSlug}/register`，登录/注册成功后回到报名页。

登录成功后：
1. `/login` 页面调用 `loginWithPassword` 或 `signUp` Server Action
2. 同步 `public.users`，并用 `iron-session` 写入 `rivalhub-session`
3. 报名页通过 `getUserSession()` 验证 session，email 字段只读且必须匹配
4. `submitRegistration` 不再包含 Auth 账号创建/密码验证逻辑，仅处理报名数据

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
