# 技术审查证据 · 共享层和检测器

采集于 2026-11-09。源码基准为 `3ac65bdf`，浏览器为线上页脚显示的 `2.25.42`。以下实测均为只读。标注源码的项目保留验证边界。

## 共享层测量

| 证据 | 环境与动作 | 结果与定位 |
| --- | --- | --- |
| SH-01 | Chrome 1414 CSS px，打开 `/stats?event=2026-nju-major`，读取 html/body 计算样式。 | html 有 `dark`，`color-scheme: dark`，该会话 `prefers-color-scheme: dark` 为 false。根 `--font-geist` 和 `--font-sans` 为空，body `--font-geist` 为 Geist 和 Geist Fallback，body `--font-sans` 仍为空，计算字体为浏览器系统无衬线栈，mono 为 JetBrains Mono。源位 `src/app/layout.tsx:54–60`、`src/app/globals.css:102–104,151–160`。 |
| SH-02 | 同页聚焦第一个「R2 Conversion 指标说明」，按 Enter 再按 Escape。 | 按钮 8×14 CSS px。Enter 打开 288×58 的 tooltip，焦点按钮通过 `aria-describedby` 关联。Escape 后浮层仍可见并保持关联。浮层计算 `pointer-events: none`。源位 `src/components/rivalhub/HelpTooltip.tsx:57–81`。 |
| SH-03 | 同一 Chrome 登录会话，`/settings/competitive` 检查 `main` 和设置导航。 | DOM 有 2 个 `main`，其中 1 个嵌套。桌面和手机导航各有 4 个设置链接，当前链接均没有 `aria-current`。未读取字段值。源位 `src/app/layout.tsx:69`、`src/app/settings/layout.tsx:10`、`src/components/settings/SettingsNav.tsx:26–45`。 |
| SH-04 | 使用仓库已安装的 Tailwind 编译器读取 `globals.css` 与默认 `theme.css`，仅在内存生成 `font-sans`、`font-display`、`bg-primary`、`text-primary-foreground`、`ring-ring`。 | `:root, :host` 定义 `--font-sans: var(--font-geist), ...`、`--color-primary: var(--color-accent)`、`--color-primary-foreground: var(--color-accent-fg)` 和 `--color-ring: var(--color-border-focus)`。生成的 `.bg-primary` 读取 `var(--color-primary)`。和 SH-01 一起确认字体声明作用域不匹配。赛事 wrapper 的覆盖与 portal 的影响来自源码及 CSS 继承规则，线上没有验证自定义色赛事全部组合。[CSS Custom Properties 的计算与继承](https://www.w3.org/TR/css-variables-1/#cycles) |
| SH-05 | 读取输入框默认 token 和底色计算对比度。竞技资料、教育空控件由参赛评估复核。 | `#1f2530` 边线对 `#0d1016` 填充约 1.24:1，对 `#10131a` 面板约 1.21:1。填充对面板约 1.02:1。另两组**源码配色**为白字对默认主色 `#ff6b1a` 约 2.85:1、`#e7ecf3` 对危险填充 `#ff5470` 约 2.62:1，分别对应直播切换选中态与 destructive 按钮。未执行需要真实动作才能看到的状态。[WCAG 文字对比度](https://www.w3.org/TR/WCAG22/#contrast-minimum) · [非文本对比度](https://www.w3.org/TR/WCAG22/#non-text-contrast) |
| SH-06 | 源码计数。统计 `src/app`、`src/components` 中含相应 JSX 调用的文件数，数字用于定位共享面。 | `PageLayout` 63，`PageHeader` 54，`HelpTooltip` 21，`StatusBanner` 17，`StatusPill` 23，`ListToolbar` 14，`Field` 6，`DialogContent` 22，`ScrollHint` 2。为文本匹配，同一文件只计一次，可能包含同名包装或测试，不能据此认定组件意图相同。 |

## 性能样本与源码线索

用 `curl --compressed` 向线上发出不带登录凭证的 GET，每个目标保留一次样本，连接与下载均有超时。计量为响应首字节、完整 HTTP 响应和传输正文，不包含浏览器渲染或脚本执行。Chrome 的只读检查接口未提供导航和资源 timing。后续应使用真实浏览器记录与分端现场分位数复核 Core Web Vitals。[Web Vitals 的采样口径](https://web.dev/articles/vitals)

| 目标 | HTTP | 首字节 ms | 完整响应 ms | 传输正文 B |
| --- | ---: | ---: | ---: | ---: |
| `/` | 200 | 80.6 | 517.8 | 20,030 |
| `/2026-nju-major/matches` | 200 | 80.5 | 756.7 | 38,553 |
| `/stats?event=2026-nju-major` | 200 | 78.2 | 370.0 | 25,261 |
| `/teams` | 200 | 111.1 | 362.1 | 27,588 |
| `/rules` | 200 | 115.8 | 214.8 | 35,801 |
| `/brackets-viewer.min.css` | 200 | 73.8 | 74.0 | 1,654 |

- `SH-07`。数据中心的浏览器 DOM 有 `/brackets-viewer.min.css` link，且样式表已挂载。根布局 `src/app/layout.tsx:56` 在所有页面引入，本地文件 6,859 B，业务消费者为 `src/components/matches/BracketView.tsx:401`。这是全局依赖证据，未归因到具体首屏耗时。
- `SH-08`。BP 房间在已结束、暂停等静止态降低网络轮询频率，但 250ms 时间循环仍更新 `serverNowMs`。源码能确认回调与状态更新，未测 CPU、功耗或掉帧。见 `src/components/matches/VetoRoom.tsx:321–343`。当前房间边界可触发 reconcile，不用活跃生产房间做压力或延时实验。
- 正向对照包括 Stats 分视图动态加载、可见比赛行才连接实时比分、纪念币 3D 按需加载且通过交互和 ResizeObserver 渲染。源码见 `TournamentStats.tsx:16–34`、`MatchListLiveScore.tsx:19–29`、`PickEmAchievement.tsx:24`、`PickEmCoin3D.tsx:117–159`。
- Telemetry 的 Distribution/Series 使用命名 SVG、live 提示、局部横滚和可展开数据表。趋势缺口保留为空，次要线使用虚线加标签。源码见 `src/components/telemetry/analysis/Elements.tsx:249,392,464–530`。尚未逐点核对真实读屏和触控。直播 iframe 有具名播放器，战术雷达资产加载有超时和失败分支，未在生产活跃比赛复核帧率或文本替代。

## Impeccable 检测结果

使用已安装的 Impeccable 4.3.1 执行 `impeccable detect --json src/app src/components`，读取仓库根的 [DESIGN.md](../../../DESIGN.md) 和 [设计 token 快照](../../../.impeccable/design.json)。两个目录共枚举 521 个文件，其中 466 个 TSX、3 个 CSS，另有 TS 与说明文档。命中按文件、行号和规则去重。退出码 2，stderr 为空。35 个文件有 **89 条**，均可回到固定源码。完整定位见[检测命中明细](2026-11-09-detector.tsv)。

| 分类 | 数量 | 处置 |
| --- | ---: | --- |
| `side-tab` warning | 7 | 工作台任务、突出比赛、选手比赛结果、确认、状态、历史规则提示和推演假设胜方均有各自上下文。保留以文字或结构表达的业务强调，独立核对其可访问性。 |
| `design-system-font-size` advisory | 70 | 50 条是 10px，另有 13px×5、28px×4、9px×3、20px×2，56/25/15/24/23/8px 各 1。地图编号等紧凑元数据、比赛比分保留现有层级。对于操作问号、必读标签和说明按触控/可读性复核。字号 ramp 漏记属于设计资料同步事项。 |
| `design-system-color` advisory | 7 | 3 条来自赛事胜方填充与文字，4 条来自纪念币展示的阴影和色晕。胜方样本上一轮实测约 5.98:1，浅色仍需重新验算。纪念币素材与装饰保留独立意图。 |
| `design-system-radius` advisory | 5 | 赛事模块 4 条 5px／9px 圆角纳入卡片角色核对。PhaseStep 的 2px 为 `var(--radius-sm, 2px)` fallback，运行时已有根 radius token。 |

本轮的无名字段、重复焦点、320px 溢出、错误范围交接等来自浏览器和源码人工核对。检测命中不用于推导 WCAG 合规结论或直接换算 P0–P3。

## 冻结前补证

### FZ-01 · 匿名浏览与环境

2026-11-09，源码 `3ac65bdf`、线上 `2.25.42`。用 Chrome 157.0.8103.39 和已安装的 Playwright 1.64.1 开独立匿名上下文。只允许指定文档、本站脚本/样式/字体的 GET，没有复用任何登录凭证；阻止 Service Worker、WebSocket、后台读请求、外部资源及一切非 GET。浏览时确有自动 POST 被拦截。未开已登录生产页、未提交表单、未调用任何业务 action。浏览器为桌面缩放视口，屏幕阅读器与真机未用。

| 取证 | 视口及观察 |
| --- | --- |
| Rivals 历史、Major 能力未启用 | 1280px：Rivals 票榜、选秀归档、队长阶段外提示/公开回链、已结束报名和报名名单；Major 直接访问投票/选秀显示能力未启用，旧 Players 入口跳到参赛阵容。Rivals 票榜、归档、队长入口与报名名单在 320px 文档宽仍为 320px。 |
| 标题与面板 | 1280px：历史票榜 H1 30px，候选标题 20px；选秀归档 H1 30px，阵容及记录标题 14px。两者密度和数据组织不同；该差异用于设计层级对照。 |
| 匿名权限与恢复 | `/my` 与 `/settings/security` 回登录且保留 `next`；`/admin` 回登录无来源。确认缺参显示「邮箱验证未完成」。找回无票据在 1280/320px 都显示两个密码字段和提交，无重发入口。 |
| Before 截图 | [无票据密码找回](2026-11-09-reset-320-before.png)：`/reset-password`，320×680 CSS px，匿名、无链接参数或浏览器恢复会话，截取标题、说明与表单区域。没有输入或提交。 |

Preview 的认证入口存在，但只读状态确认服务 `inactive`。宿主剩余内存低于该服务上限，保持按需服务关闭。本机 Docker daemon 不可用，无隔离的 Local Supabase 服务。以下夹具仅使用 loopback、合成数据和替代 action，不接真实 DB、Auth、邮箱或调度器。

### FZ-02 · 主题作用域与实测配色

用仓库安装的 Tailwind 4.3.3 编译 `src/app/globals.css` 与源码 class，以 `seasonAccentStyle` 创建合成赛事 wrapper。渲染真实 Button、Input、Select、Dialog、DropdownMenu、HelpTooltip 和 MatchLiveViewing；Next 的 Link 只作本地展示。loopback HTTP 只提供静态夹具，阻断外网、表单提交和 iframe。Chrome 采集计算样式和 Portal 与 wrapper 的包含关系。

| 取证条件 | Chrome 观察 |
| --- | --- |
| 390px，自定义 `#4ade80` | 直接取主色的文字/填充为 `#4ade80`，默认 Button 填充仍 `#ff6b1a`。Button 直接取焦点为 `#4ade80`，Select 的 `ring-ring` 为 `#ff6b1a`。使用历史 Rivals 的 `#f97316` 再测，填充别名仍为根橙。 |
| 开启浮层 | Dialog、Select、DropdownMenu 与 HelpTooltip 不在赛事 wrapper 内，均解析到根主色。Dialog 内直接取主色的样本为根橙；HelpTooltip 平时使用中性表面，作用域差异本身不等于可见缺陷。Dialog 在 390px 为 358px 宽，在 1280px 为 448px。 |
| 真实填充与边界 | 根色下合成两位进行中解说，初始选中为白／橙 **2.85:1**。真实 destructive Button 为 `#e7ecf3`／`#ff5470` **2.62:1**。输入框边线对内嵌底色 **1.24:1**、对面板 **1.21:1**；填充对面板 **1.02:1**。 |
| 合法输入色边界 | `#777777` 的函数选色为 `#0a0c10`（**4.37:1**）；代入白字为 **4.48:1**。赛事 `#111111` 的 Button 实测焦点色对页面 **1.04:1**、对面板 **1.02:1**。这些颜色仅用合成组件取证，未改赛事配置。 |

对比度按相对亮度 `(L较亮 + .05) / (L较暗 + .05)` 计算，实际字号和边界用途分别按 [WCAG 2.2 文字对比度](https://www.w3.org/TR/WCAG22/#contrast-minimum) 和 [非文本对比度](https://www.w3.org/TR/WCAG22/#non-text-contrast) 判断。[CSS 自定义属性计算规则](https://www.w3.org/TR/css-variables-1/#cycles)

Before：[赛事 wrapper](2026-11-09-theme-scope-390-before.png) · [打开 Dialog](2026-11-09-theme-portal-390-before.png)。两张为本机 `/theme`，390×700 CSS px，合成赛事 `#4ade80`，深色，未提交。第一张保留主按钮、直接取色、禁用和输入边界，第二张用同一赛事打开真实 Portal。

### FZ-03 · 报名、选秀与纪律隔离复现

使用仓库安装的 Vitest 5.0.5／jsdom，加载真实 TSX 与表单库，以合成 DTO、受控 Promise、假时钟及 stub 替代网络、会话和动作。参赛/选秀共 3 个临时夹具、13 个场景通过；纪律另 1 个场景通过。未运行项目 E2E/数据库集成套件。

| 证据 | 复现及边界 |
| --- | --- |
| UIA-033、034、044 | `RegistrationForm` 开放个人报名：保持读取 Promise pending，改「游戏风格自述」，释放同字段草稿，DOM 显示旧值，save/submit 调用为 0。合成完整草稿的承诺值为 true，控件未勾，mock submit 接到 true。闭窗时字段可编辑但提交/草稿禁用；返回字段错误只显示通用 toast；成功 DTO 显示回执且没有进度链接。真实审核、落库和关闭竞争未测试。 |
| UIA-042、045、046 | 队长未启动时，实际 page 的 SSR 夹具仅有等待提示。进入本队回合后模拟 10s 轮询，注入一次传输拒绝，候选继续 disabled，之后 30s 无第二次刷新。后台给无可选者/完结 DTO，分别只见暂停/恢复以及「已暂停」「第 7 / 6 轮」。队长确认给 8 名候选、0 票仍可进入，mock 只接赛事 ID；真实排序函数对后到票样本重算时名单变化。状态与时钟来自合成数据，无实际定时调度或提交。 |
| UIA-041 | 让 Alpha、Beta 两个搜索均已发出，先兑现 Beta，再兑现 Alpha；输入仍 Beta，结果仅 Alpha。选择 Alpha 并签发，mock 接到 Alpha ID。未处罚用户。对照 `UserSessionControl.tsx:40–60` 现有请求代际守卫。 |

### FZ-04 · 高影响与性能的剩余边界

- **UIA-028。** `postmatch-community-awards.test.ts` 有清除认领的持久化场景，末轮只核对断言。通用转移在 `competition-policy.ts:21–25` 排除 Play-in；托管 Swiss 的 `src/lib/major/swiss-runtime.ts:63–77,163–186` 要求完赛事实。常规更正仅已结束，弃赛也走状态机。无 Swiss 且满足终态条件才走 `src/lib/seasons/transitions.ts:79–107` 的赛季收尾。盘口锁定与 dirty 来源为 `0096_bet_locked_market_noop.sql:24–29,60`；退款由后续 `bet/domain.ts:122` 和 `bet/service.ts:470–491` 决定。未执行取消、退款或竞态。
- **UIA-035、036、047、049。** 会话 fixture `application-sessions.test.ts:145–163` 与 `identity-revocation-race.test.ts:50–111` 支持全账号旧会话范围与并发保护。找回的 provider session 行为按已安装 Supabase SDK 2.118.0 及默认 `persistSession`、`detectSessionInUrl` 核对；没有验证遗留真实 token 或消费实际邮件。Next 16.4.3 本地指南 `authentication.md#layouts-and-auth-checks` 建议在 data source 附近检查授权；现有跨届内容 E2E 的覆盖范围不能代替这些私有读取页的验证。实际改密目标、拒绝态、RSC 与会话清理须用隔离角色验证。
- **UIA-029。** 4 次/秒是源码 interval 调度，不等于每秒四次 React commit 或实际耗电。采样固定可见状态、设备节流和暂停/恢复；保留回前台重读、到期及待补缓存投递。没有生产活跃 BP trace。
- **UIA-030。** 赛后资料为父查询和八组批读，后续全范围投影再分页。已有小规模 fixture 保护缺口及恢复正确性。对照实验调用真实 `betOperationsList`，构造 25/100/250 个组，每组 5 市场：每次返回 10 组，`matchId` 属性读取分别为 3,250／50,500／313,750 次。它只量算法访问，不量 DB、Flight 字节或用户时延。两条读路径分别采样，在已知瓶颈上改动。
