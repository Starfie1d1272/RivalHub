# UI 视觉设计

> 所有页面基于深色主题，详细 token 值见 `docs/ui-tokens.md`。

---

## 通用三态规范

每个数据展示区域必须处理以下三态：

| 状态 | 展示方式 |
|---|---|
| Loading | Skeleton 占位（灰色方块，高度与实际内容一致） |
| Empty | 居中图标 + 一行说明文字 + 可选的行动按钮 |
| Error | 红色 Toast 提示 + 页面内 Error UI（不替换整页） |

---

## 首页 `/`

**Hero 区（三态动态）**：根据活跃赛季状态切换底色渐变（registration → 绿色 `rgba(77,212,122,0.09)`；voting → 黄色 `rgba(255,196,77,0.09)`；playing → 橙色 `rgba(255,107,26,0.13)`）+ 网格背景纹理。Eyebrow mono 小标 + Display 大标题 + 副标题 + 操作按钮组 + MiniStat 三格（TEAMS / PLAYERS / STAGE）。无活跃赛季时显示静态纯暗色 Hero。

**赛季导航（三层）**：
- Tier 1（主入口）：1 张全宽 accent 边框卡片，当前最重要的行动（报名/投票/查看赛程），hover 时 `--color-accent-edge` 描边加亮。
- Tier 2：`grid-cols-4` 网格，队伍/数据/排行等次级入口，hover 时 border 变亮。
- Tier 3：ghost 小按钮行，规则书/个人主页等辅助入口。

其他赛季 `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` 归档卡片；无活跃赛季时 Tier1/2/3 均隐藏，仅显示 `EmptyState`。

---

## 赛季首页 `/[seasonSlug]`

SeasonNav（ScrollHint 横滚渐变遮罩）→ 标题区（StatusPill + 赛季大标题）→ Phase Tracker → 内容双栏 → Stat 四格。

**Phase Tracker**：capability 驱动，步骤横向排列，步骤之间用 2px 细线（`--color-border`，已完成段变绿色 `rgba(77,212,122,0.35)`）连接。每步含 24×24 方形图标（`--radius-sm`）+ mono 小标签，居中对齐于连接线。当前阶段 `--color-accent` 橙色 + 淡底色；已完成 `--color-ok` 绿色 + ✓；待完成 `--color-fg-dim` 灰色。使用 `<PhaseStep>` 组件，`ScrollHint` 横滚包裹。

**内容区双栏**（`status === "playing"` 时）：左侧 NEXT MATCHES（最近 4 场 scheduled/in_progress，`formatCSTShortDate` 日期，LIVE 绿色 mono 标注）+ 右侧 STANDINGS 积分榜（胜场/平局/负场/积分列，当前用户所在队高亮）；`playing` 以外状态只展示 Quick Links（1/2/4 列响应）。

Stat 四格（`<Stat>` 组件，TEAMS / PLAYERS / MATCHES / STAGE，MATCHES 格式 `finished/total`，无比赛显示 `—`）。

---

## 报名页 `/[seasonSlug]/register`

页面结构：Eyebrow + Title + Sub 模式（mono 小标 + 大标题 + 副标题）。位置实时容量 + 进度条，满员位置置灰并显示"已满"。NJUBox 截图链接选填（一个链接内包含近两周 5 场截图）。anti-cheat 勾选框必须确认。提交按钮 loading 时 disabled + spinner。

---

## 队长投票页 `/[seasonSlug]/captains`

页面标题统一为 Eyebrow + 大标题 + 副标题三层结构。

**桌面端（≥ md）**：表格布局，排行榜含姓名、实时票数进度条、投票/撤回操作列。

**移动端（< md）**：`CaptainVotingPanel` 自动切换为候选人卡片列表，每卡片含票数进度条 + 投票按钮。通过 `useMediaQuery("(max-width: 767px)")` 切换渲染模式。票数 Supabase Realtime 实时更新。

---

## 选秀直播间 `/[seasonSlug]/draft`

**桌面端（≥ md）**：`TeamDraftGrid` 8 格横向网格，`md:border-r` 分隔线，当前选秀队卡片高亮（theme_color 边框），倒计时 < 30s 变红。

**移动端（< md）**：手风琴列表，当前选秀队自动展开，其余可点击展开/折叠（`expandedId` state）。

下方剩余选手池按位置分组展示。

---

## 队长面板 `/[seasonSlug]/draft/captain`（仅队长可见）

回合标注 + 倒计时 + 队伍已选阵容 + 位置缺口提示。可筛选位置的选手列表，非当前轮次"选择"按钮 disabled。选择后立即 optimistic update，等待服务端确认。

---

## 队伍列表 `/[seasonSlug]/teams` 与详情

**列表**：8 队卡片网格 `grid-cols-2 lg:grid-cols-4`（移动端 2×4），每卡片含队名 + 队长名 + 7 人头像列表，点击跳转详情。

**详情**：首发阵容 + 替补分区，队长 badge 标识；战绩/数据 grid 响应式折行，阵容行 truncate 防溢出。地图胜率颜色编码：≥ 60% 用 `--color-ok` 绿色，≤ 40% 用 `--color-danger` 红色，中间段用默认前景色。地图胜率面板（`StandingsTable`）同时展示 BAN 率。

---

## 赛程页 `/[seasonSlug]/matches`

Bracket 图（`brackets-viewer` 渲染，注入 season theme_color）与排位赛列表联动；Bracket 节点点击跳转详情，详情页"查看对阵图"回链。

---

## 比赛详情 `/[seasonSlug]/matches/[matchId]`

双方阵容 + 比分 + 地图结果（每图 Team A / Team B 双栏 K/D/A/ADR/Rating）。单场 MVP 投票区。

---

## 管理后台

- `/admin/login`：标准居中登录卡片，invite code + password 两个输入框。
- `/admin/[seasonSlug]/registrations`：表格布局，列：邮箱 / 主选 / 段位 / 截图 / 状态 / 操作（通过/拒绝/等待）。
- `/admin/[seasonSlug]/captains`：左侧投票排行 + 右侧确认按钮组（选择前 8 名 + 手动排序 draft_order）。
- `/admin/[seasonSlug]/draft`：一键开始/暂停选秀 + 强制跳过当前队 + 实时日志。
- `/admin/[seasonSlug]/matches`：比赛卡片列表，`in_progress` 状态卡片左侧有 3px `--color-accent` 橙色竖线标识。每张卡片用 `<details>` 折叠操作区（录入比分、Roster、BP 等），默认收起，点击展开。

---

## 移动端断点策略

- `sm`（640px）：导航折叠为 hamburger
- `md`（768px）：报名表单单列 → 双列；队长投票表格 → 卡片列表；选秀网格 → 手风琴
- `lg`（1024px）：选秀直播间 4 列队伍网格；首页 Hero 两栏布局
- 全站最小宽度：320px
