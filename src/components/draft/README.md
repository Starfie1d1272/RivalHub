# components/draft

蛇形选秀 UI 组件。

## 规划组件

| 组件 | 说明 |
|---|---|
| `DraftLiveRoom` | 选秀直播间主容器（围观视图，Realtime 订阅） |
| `TeamDraftGrid` | 8 队网格，当前选秀队高亮 |
| `TeamSlot` | 单队卡片（队长 + 已选队员列表） |
| `PlayerPool` | 剩余可选选手池（按位置分组，支持筛选） |
| `DraftCountdown` | 倒计时组件（< 30s 变红，Client Component） |
| `CaptainDraftPanel` | 队长操作面板（仅当前轮队长可见 + 操作） |
| `PickAnimation` | 选手飞入动画（pick 事件触发） |

## 实装阶段

- Phase 7：围观视图（Realtime）
- Phase 8：队长面板 + 超时逻辑
