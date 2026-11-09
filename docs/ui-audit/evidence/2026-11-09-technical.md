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
