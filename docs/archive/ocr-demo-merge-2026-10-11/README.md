# OCR 与 Demo 草稿合并截图证据

Refs #898。图片使用合成十人数据，组件为本 PR 的真实 StatsOCRPanel、共享 Button/Input/Select/Table/InlineConfirm 和仓库样式；Vite review harness 仅模拟 server action 返回，不连接生产或数据库，不宣称管理员登录授权 E2E。

真实 Chromium 1440/390/320px：各有 entry（Demo 已有但缺指标的直接补传入口）、merge-options（十三行中未匹配行可选择已占用 Demo 选手，菜单含完整长昵称）、merged（三次明确选人后剩十行）。页面无横向溢出，表格局部横向滚动，长昵称截断有完整 title，菜单限定 viewport 并换行；没有 pageerror。展开单图检查、三行合并、可保存状态与取消零写调用均已检查。

定向组件/草稿/保存字段 ownership 共23项单测；真实 PostgreSQL 的 demo-integration-submit “adopts a submitted 10-player roster despite OCR scoreboard drift and preserves OCR-owned stats” 回归通过（1 passed、另1不相关测试跳过）。后者使用可丢弃的本地隔离数据库，验证 OCR-first→Demo promotion 保留指标；UI和纯草稿回归覆盖 Demo-first、不同昵称必须人工选人、重复补传、取消恢复，不用昵称近似推断身份。app/tests types、changed ESLint 与 architecture 检查通过。

临时复现工具和完整日志保留于私有 .agent-tmp/ocr-review，不是新的应用入口；这些图片不含用户原图、生产账号、标识或比赛资料。
