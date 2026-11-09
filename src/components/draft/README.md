# components/draft

Rivals 蛇形选秀 UI。领域流程与并发/幂等边界见 [`docs/workflows.md`](../../../docs/workflows.md#rivals)，UI 契约见 [`docs/ui-system.md`](../../../docs/ui-system.md)。

## 组件职责

| 组件 | 说明 |
|---|---|
| `DraftLiveRoom` | 读取服务端选秀状态；进行中轮询，暂停时降低频率，完成或只读模式停止轮询 |
| `TeamDraftGrid` | 赛事队伍网格，展示队长与已选成员并高亮当前选秀队 |
| `PlayerPool` | 按主选、次选位置筛选待选选手，计数与结果共用同一集合 |
| `DraftCountdown` | 倒计时组件（< 30s 变红，Client Component） |
| `DraftCaptainWaiting` | 已确认队长等待开选时自动更新，并提供手动刷新 |
| `CaptainDraftPanel` | 绑定当前选人顺位和截止时间提交，请求返回后先核对最新轮次和阵容 |
| `DraftAdminPanel` | 管理选秀生命周期，确认并处理超时且无合资格选手的轮次 |

界面只展示已提交的领域状态；倒计时与按钮可用性不能代替服务端的超时处理、身份和轮次校验。
