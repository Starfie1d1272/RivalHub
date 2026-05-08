# 报名流程

## 完整流程图

```
用户访问 /[seasonSlug]/register
  ↓
检查赛季状态是否为 registration（Server Component fetch）
  ├── 否（已截止 / 未开放） → 显示"报名未开放"提示
  └── 是 → 渲染报名表单
        ↓
        展示各位置已报名人数（页面加载时静态渲染，提交后服务端二次校验）
        ↓
用户填写表单（含 NJUBox 截图分享链接）
  ↓
客户端 Zod 校验通过
  ↓
调用 submitRegistration Server Action
  ↓
服务端 Zod 二次校验
  ↓
检查位置是否已满（COUNT GROUP BY，带 FOR SHARE 防竞争）
  ├── 已满 → 返回错误"该位置已满员"
  └── 未满 → INSERT season_registrations（status=pending）
              ↓
              触发 Magic Link 邮件（supabase.auth.signInWithOtp）
              ↓
              返回成功 → 页面跳转"报名成功，请查收邮件"
```

---

## 截图上传

**当前方案（v1）**：选手将 5 张天梯截图上传至 NJUBox（https://box.nju.edu.cn），获取分享链接后填入报名表单的「NJUBox 分享链接」字段。提交时直接存储该 URL。

**未来方案（Phase 5+）**：支持客户端直传 Supabase Storage，避免依赖第三方图床。
- Bucket 名称：`registration-screenshots`
- 权限：私有（不公开访问）
- 管理员审核时通过 Service Role 生成签名 URL（有效期 1 小时）

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
| `email` | 邮箱（用于 Magic Link） | 有效 email 格式 |
| `studentId` | 学号 | 非空；毕业生填「毕业年份+学院」 |
| `qq` | QQ 号 | 5-12 位数字 |
| `perfectId` | 完美平台 ID | 非空 |
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
| `screenshotUrl` | 天梯截图 NJUBox 分享链接 | HTTPS URL |
| `gameplayStyle` | 游戏风格自述 | ≤100 字 |
| `antiCheatPledge` | 反作弊承诺勾选 | 必须为 true |

### 报名段位门槛

**以下两个条件满足其一即可报名**：
- 当前赛季最高段位 ≥ **A**（含）
- 历史最高段位 ≥ **A+**（含）

校验在 Zod schema（客户端）和 Server Action（服务端）两层执行。

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

## Magic Link 与 users 表关联

用户首次点击 Magic Link：
1. Supabase Auth 创建 `auth.users` 记录
2. 通过 Supabase Auth webhook（或 after-login callback）在 `public.users` 插入记录，`auth_id` 关联
3. 将 `season_registrations.user_id` 更新为新创建的 `users.id`

**v1 简化方案**：报名时先以 email 作为临时标识存入 `season_registrations`，Magic Link 点击后再关联 `users.id`（通过 Supabase Auth trigger）。

---

## 错误状态 UI

| 场景 | 提示 |
|---|---|
| 赛季不在报名阶段 | "报名通道未开放，请关注赛委会公告" |
| 位置已满 | "该位置主选名额已满，可选择其他位置报名" |
| 已报名过 | "您已提交报名，请等待审核结果通知" |
| 截图上传失败 | "截图上传失败，请检查网络后重试" |
| 提交失败（网络） | Toast 错误提示 + 允许重新提交（幂等）|
