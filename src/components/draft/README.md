# components/draft

Rivals 蛇形选秀 UI。领域流程与并发/幂等边界见 [`docs/workflows.md`](../../../docs/workflows.md#rivals)，UI 契约见 [`docs/ui-system.md`](../../../docs/ui-system.md)。

## 组件职责

| 组件 | 说明 |
|---|---|
| `DraftLiveRoom` | 读取服务端选秀状态；进行中轮询，暂停时降低频率，完成或只读模式停止轮询 |
| `TeamDraftGrid` | 赛事队伍网格，展示队长与已选成员并高亮当前选秀队 |
| `PlayerPool` | 剩余可选选手池（按位置分组，支持筛选） |
| `DraftCountdown` | 倒计时组件（< 30s 变红，Client Component） |
| `CaptainDraftPanel` | 队长选人面板，按当前轮次与位置名额限制提交，并携带请求幂等标识 |
| `DraftAdminPanel` | 管理员开始、暂停与恢复选秀 |

界面只展示已提交的领域状态；倒计时与按钮可用性不能代替服务端的超时处理、身份和轮次校验。
