# OCR 提交回执与恢复验收

验收源码候选为 `1e8b54e431c670b8bda1843206ffd738762e4977`：main `49c6c7fd` + W03 locks `0e4b2ea9`、migration `0f1cdaa3`、BP fixture `7e58a816` + 自有 consumer + actor/OCR 竞态修复。0097/0098 snapshot 五类 facts 与上限 5 对齐，正式 revalidation 导出已接入。候选在独立组合分支验证，不应整分支合并；最终 main 须核对相同补丁、依赖及 required CI。

## 完成行为

- 保存/清除携带 operationId、expectedVersion、expectedActor。fresh season-admin 授权后 actor 不同则 fail closed；请求不能按新 actor 提交却把 locator 存在旧 actor 下。原权限拒绝保留。
- 原 match SHARE → map UPDATE → stats 顺序由 canonical season fence 包含；锁后版本比较，facts/audit/receipt 同事务。摘要绑定原 actor/map/kind/base/input；原编号重放仅返回原回执。
- 版本覆盖同一读取快照的完整内部计分板事实和精确 PG 时间戳；只返回不透明 hash 与 editor DTO。DAK lineage/审核来源不下发。
- OCR、save、clear 同步互斥；异步 OCR 应用结果前还检查 epoch、操作 owner 和 pending operation。不会在 save unknown 后用晚到 OCR 覆盖草稿。
- 仅持久化 actor/map/operation、类型与基准版本 locator，按 actor/map/operation 独立键保存在 localStorage，不保存草稿、图片或凭据。原页面 unknown 保留内存草稿；重开明确只恢复编号，未持久化关闭前草稿。locator 写入失败不发送 mutation。
- 重开先 fresh 授权核对 actor，再查原 operation 回执。missing 不证明回滚，不清编号或重写；superseded 明确原提交成功且已有后续更改，只载入当前事实。确认后仅清当前 locator，单独重试缓存失效。

## 验证

- app/tests types、architecture、changed ESLint 通过；组件 14 项 + version/digest 2 项通过。包括 deferred OCR/save 互斥、actor 绑定、late props/busy owner、跨 actor 和持久 locator。
- Canonical 真实隔离 PG 五文件 9 项通过：非空 save 实际写统计，同 op 并发仅一次 audit/receipt，双非空 command CAS 只通过一个；旧 op 在 superseded 后 replay 不覆写；原子回滚、fresh actor 拒绝、名单安全、旧新 worker 40P01 对照及完整 DAK/OCR 兼容。不是用 mock 替代 PG 并发。
- 真实 Chromium 四项通过。使用原生 persistent context 的磁盘 profile，关闭整个浏览器进程后重启，未用 storageState 导出/注入模拟重开。覆盖真实非空提交后丢 HTTP 响应、actor/权限变化、missing 和另一管理员真实提交后的 superseded。测试最终等到可继续编辑，包含回执确认后的失效阶段。
- 故障边界严格区分：PG 用例在真实 COMMIT 完成后由 adapter 抛错，模拟丢 acknowledgement，并非实际 PG wire 断连接；浏览器用例以 route.fetch 执行真实 HTTP Server Action，再 route.abort 丢弃浏览器响应。missing 在转发前中止请求。没有调用付费 OCR provider。

[机器可读结果](ocr-browser-proof.json) 从实际 canonical runner 成功日志提取；测试位于 `tests/e2e/flows/ocr-receipt-recovery.spec.ts`。复现：

```sh
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm db:local:bootstrap-services
pnpm exec playwright install chromium
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:e2e -- tests/e2e/flows/ocr-receipt-recovery.spec.ts --project=chromium --workers=1 --reporter=list --max-failures=1
```

仅本地隔离 fixture 与 Next dev 功能证据，不宣称生产改善、LCP、移动端或模型精度。两个首轮测试修正只涉及 fixture approved revision、等待完整失效恢复及 Node fixture 回调命名，未放宽领域门禁、timeout 或 retry。profiles、fixture 用户与数据在 teardown 清理；不提交凭据、profile 或原始运行日志。
