# W12/W13 有界验收补充

仅隔离 Local Supabase/PostgreSQL fixture 与原生 Chromium；无生产写入、真实发信或付费 OCR。生产部署性能目标仍须最终集成环境测量。

| task | 本轮具体证据与边界 |
|---|---|
| AS03 | `my-rsc-memo.test.ts` 以真实 react-server dispatcher 子进程渲染 personal/team 两个组件，调用真实 read owner、真实 PostgreSQL；每个 RSC 请求仅一次 next-match 链，第二请求重读，共两次。无 cache/dispatcher mock；随机无参赛用户只证明去重/请求隔离，不伪称完整历史人口实验。 |
| AS04 | `account-registration-windows.spec.ts` 在 fixture 自有 season 克隆上逐个测试 custom(team)/rivals(solo)/Major 的 upcoming/open/closed 九个页面；未来/截止不开放创建入口。原有 registration-opening、season-registration-correctness、team-registration 五项 PG 回归另过；毫秒边界及资格/冻结链仍由对应领域 PG 测试保护。完整 candidate/approved-revision/淘汰状态不能仅由这九页推定。 |
| AS07 | `account-transport-budget.spec.ts` 原生浏览器拦截本地 Login Server Action 的网络失败，保留输入并恢复可操作表单；实际 Next 底层尝试三次后才显示受控提示，不能写成一次 HTTP。这些拦截均在转发前，未调用 provider；不代替真实已提交凭据变更丢响应与 DB deny-fence 的独立 PG 证据。 |
| AS09 | 相同 spec 在真实 Next HTTP action 解码入口发送 7 MiB 原图的 base64 大小等价对象 envelope，分别正常/64 KiB 每 50ms 分块上传。动作使用无效邮箱在 provider/DB 前拒绝；不是 OCR 精度或付费模型测试。超过 10 MiB 被框架 body-limit 拒绝，当前 Next dev 对 action 返回 HTTP 500 和 body-limit 错误，不能伪记 413。生产反代限制未验证。 |
| AS14 | `account-form-readiness.spec.ts` 等待安全/竞技/教育真实可编辑控件，分别收集 enabled-form-ready 时间和带 source tag 的 layout-shift 条目；不以 TTFB 代替。原三个页面 session connection() 导致 uncached-data 警告；layout 外层边界实验未消除，已撤回；改在各页面 await 会话前的真实 leaf Suspense 后，三条警告消失，控件仍可编辑。未启用生产 telemetry flag；生产 build、冷热/设备 cohort、p75/p95 和 CLS 目标仍由最终集成测量。 |

## 重跑

```sh
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:integration -- tests/integration/db/my-rsc-memo.test.ts tests/integration/db/registration-opening.test.ts tests/integration/db/season-registration-correctness.test.ts tests/integration/db/team-registration.test.ts
RIVALHUB_ALLOW_LOCAL_CONTAINERS=1 pnpm test:e2e -- tests/e2e/flows/account-form-readiness.spec.ts tests/e2e/flows/account-registration-windows.spec.ts tests/e2e/flows/account-transport-budget.spec.ts tests/e2e/flows/major-entry.spec.ts --project=chromium --workers=1 --reporter=list,json --max-failures=1
```

JSON reporter 的 `settings-actual-form-readiness` 与 `local-action-body-budget` 附件包含有限测量结果，不含账号、密码、图片或草稿。原始运行日志和 fixture 凭据不入库。三个页面只移动 await 到各自 Suspense 子组件；授权与资格未延后到可编辑表单之后，ContentReady 仍在已读事实旁，fallback 不报告 ready。
