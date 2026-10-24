# AS13 / AS15 / AS16 状态核对

## 契约与边界

- `src/actions/matches/roster.ts`: `getMatchRosterReadback(matchId: string, requestedEntryId?: string): Promise<ActionResult<RosterReadback>>`。当前参赛代表读取自己队伍；显式读取对方必须重新通过赛事管理员授权。一次 scoped 查询返回 rosterId、status、starterIds、substituteIds、BP 代表与内容版本。
- `src/actions/postmatch.ts`: `getMatchRecordingReadback(matchId: string): Promise<ActionResult<RecordingReadback>>`。重新验证赛事管理员，再读取原 ID、解说、标题、URL 和相对顺序。异常数据返回 typed error，不能伪装成空列表。
- `src/actions/matches/scheduling.ts`: `getTimeProposalReadback(proposalId: string): Promise<ActionResult<TimeReadback>>`。重新验证当前参赛代表或赛事管理员；读取原 proposalId、status、resolution、proposedTime、scheduledAt、rejectReason。仅 scheduledAt 相同不能确认原提议。
- `retryTimeProposalRefresh(proposalId: string): Promise<ActionResult<void>>` 只执行重新授权后的缓存失效。录像、名单继续复用既有刷新入口。

SHA-256 内容版本来自当前完整语义投影，是状态相等检查，不是单调 revision、CAS 条件或 durable receipt。名单成员按集合排序；录像保留相对顺序；提议包括原 ID 与处理方式。录像纯投影由写入 owner 和客户端共用，授权、锁后准入和 audit 仍在原事务 owner。

未知结果保留草稿、原录像 ID 或原提议 ID，禁止自动重放。即使读取匹配，也只显示当前保存状态相同，不宣称原请求已提交。读取失败不清空选择。明确成功但刷新失败可只重试失效；本次不新增数据库表、持久浏览器草稿或写入重试策略。

## 可重复证据

- `pnpm exec vitest run tests/unit/components/operation-readback.test.tsx tests/unit/operation-readback.test.ts tests/unit/match-recording-editor.test.tsx tests/unit/components/long-operation-transport.test.tsx`: 10 项通过。覆盖 unknown 后核对、顺序/原 ID/内容不一致、名单替补与 BP 代表、同排期不同提议、匹配仍不重放。
- `RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:integration -- tests/integration/db/operation-readback.test.ts tests/integration/db/postmatch-community-awards.test.ts tests/integration/db/match-time-scheduling.test.ts`: 12 项真实 PostgreSQL 通过。核对实际代表转移、管理员拒绝分支（该文件采用 auth mock）、拒绝前不读取私有名单/录像、原提议状态变化与只读 audit 不变；同时复验原录像与排期事务不变量。
- `RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:integration -- tests/integration/db/operation-readback-auth-chain.test.ts`：额外 1 项真实授权链补验通过。实际 iron-session/application registry/角色/grant 实现完成添加 grant→读取成功→删除 DB grant→三入口 FORBIDDEN/私有 SQL 0→恢复 grant→成功→撤销 registry session、保留签名 cookie→三入口 UNAUTHORIZED。仅 Next cookie/connection 平台传输适配；不冒充 provider 登录或真实 HTTP。原始补验提交 [`27e8f15d`](https://github.com/Starfie1d1272/RivalHub/commit/27e8f15d7d4da9a3fd5a6971cb13d6a110a47246)，证据边界见 [真实应用授权链撤销补验](readback-auth-chain.md)。
- app/tests 类型检查、架构检查和变更源码 ESLint。原始日志、fixture 账号与本地凭据不提交。

这组证据不代表生产部署性能改善，不替代 OCR durable receipt 的浏览器关闭重开证据。AS03/04/07/09/14 的有界覆盖核对另行记录，不在此宣称完成。
