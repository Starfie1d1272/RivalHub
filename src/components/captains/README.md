# components/captains

Rivals 队长投票与管理员确认 UI。领域流程见 [`docs/workflows.md`](../../../docs/workflows.md#rivals)。

| 组件 | 说明 |
|---|---|
| `CaptainVotingPanel` | 公共投票与结果页：候选人排序、投票 / 撤票，并用 10 秒轮询刷新 |
| `CaptainConfirmPanel` | 管理员确认前 8 名面板：生成本届参赛记录与赛事名单、推进赛季到 `drafting` |

## 当前约束

- 公开页面从登录态和本届已审核报名记录推导 `currentVoter`，只加载该报名记录的已投票；没有公共报名身份选择器。
- `castVote` / `retractVote` 在服务端重新验证报名记录归属当前登录用户；Client 传入的 `voterRegistrationId` 不能代替授权。
- 排序规则与 Server Action 共用 `src/lib/captains/rules.ts`：票数降序、历史最高 Rating 降序、报名时间升序。
