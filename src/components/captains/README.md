# components/captains

Phase 6 队长投票 UI 组件。

| 组件 | 说明 |
|---|---|
| `CaptainVotingPanel` | 公共投票与结果页：候选人排序、投票 / 撤票、Realtime 订阅 `captain_votes`，并用 10 秒轮询兜底刷新 |
| `CaptainConfirmPanel` | 管理员确认前 8 名面板：生成 `teams`、写入队长 `team_members`、推进赛季到 `drafting` |

## 当前约束

- Phase 6 仍沿用现有报名记录身份输入，公共页面通过报名身份选择器调用 `castVote` / `retractVote`。
- 后续接入完整用户 session 后，应从登录态推导 `voterRegistrationId`，移除公共选择器。
- 排序规则与 Server Action 共用 `src/lib/captains/rules.ts`：票数降序、历史最高 Rating 降序、报名时间升序。
