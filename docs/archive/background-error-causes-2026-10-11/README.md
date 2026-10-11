# 后台失败原始原因补齐

Refs #912/#571；全仓覆盖地图见 [第一批矩阵](https://github.com/Starfie1d1272/RivalHub/blob/fix/error-flow-audit/docs/archive/error-flow-audit-2026-10-11/README.md)。Baseline main `296e35db`。

统计投影repair的候选查询与单图重建 catch仅增加failed数，Demo单项与身份确认后的fanout候选载入catch也只返回failed摘要。原DB runtime可能已有SQLSTATE事件，不能宣称整个平台完全无原始原因；这些领域边界本身缺阶段/原异常投影，coding/provider错误更难在摘要中归因。

修复仅在原catch边界capture原异常，由既有canonical sanitizer限制cause/SQLSTATE、去除SQL/params/detail/token；不附加账户/赛季/地图/import标识，不把原始error塞进返回summary/持久化issues。保留原计数、循环、中止条件和事务：先前成功的统计投影仍计rebuilt、成功Demo仍进affectedMatchIds、身份确认成功不因fanout失败变成错误。scheduler最终摘要仍保持failed健康信号，不以关日志或吞error隐藏失败。DB、item、scheduler摘要属于同一trace的不同信号，不当成多个incident。

新增最低证据为transaction边界故障注入与actual logger/redactor：candidate_selection SQLSTATE、后续rebuild cause及先前committed计数、Demo per-item部分成功和failed事实、现有Action fanout失败仍返回身份确认成功。mock不验证SQL/锁/提交；这些行为仍由现有真实PG suites拥有，CI按affected surface叠加原集成回归。

未处理宽catch把target读取故障转成业务issue的问题，未声称已证明生产状态污染；该项需要专门的实际PG故障与facts不变回归。密码/provider/客户端stale恢复与外部sink验收继续留#912/#571；删除/恢复撤销归#903/#904。未编辑src live读链，不发版、不修改生产数据或凭据，不操作Windows。

旧owner定向回归4 failed/8 passed；修复后相关4个文件19 passed。app/tests类型、定向ESLint、architecture与diff check通过。远端required CI与独立exact-head复审仍按PR实际状态记录，不由自审替代。

复现：

```bash
pnpm exec vitest run tests/unit/lib/stats-projection-repair-diagnostics.test.ts tests/unit/lib/demo-recheck-diagnostics.test.ts tests/unit/actions/demo-integration.test.ts tests/unit/lib/scheduler/runners.test.ts
pnpm type-check:app
pnpm type-check:tests
pnpm architecture:check
```
