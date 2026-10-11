# BP 参与与申诉生命周期视觉核验

2026-10-11，真实 Chromium，1440 / 390 / 320 像素。

`*-prepared.png` 与 `*-closed.png` 渲染仓库真实 VetoRoom、Panel、按钮、链接与样式；Next 路由和 server actions 使用隔离 fixture，分别模拟本方已准备、对手未确认，以及开赛后已结束的恢复申诉。`*-captain-entry.png` 是实际单场 RSC 页面在既有队长权限单测 fixture 下渲染出的 HTML；周边复杂子组件按该测试原 mock 简化，BP 区域与入口使用实际页面 JSX。

这证明实际组件/入口布局与文案，不是生产登录或完整赛事 E2E。权限、事务和生命周期另由真实 PostgreSQL 与 server action 边界回归保护。

自审：窄屏指引自然换行，无页面横向溢出；已确认按钮保留禁用状态；等待对手、留在本页与操作倒计时的下一步清晰。参与入口仍导航原 BP 页面，不另建 BP 流程。无生产读写、无参与预测、无积分/裁定改动。
