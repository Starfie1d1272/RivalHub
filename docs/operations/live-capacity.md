# LIVE 接收容量与 authority 边界

本专题只拥有接收端准入与投递；`source.ts`、`installation.ts` 和 canonical result owner 继续拥有源接管、撤销和官方赛果。公开 `rivalhub.public-live.v1` / topic / viewer JWT 不变。模拟测量不是生产事故证据或 provider 容量证明。

## 实现前的不变量与并发时序

1. 每份尝试必须重新验证 installation → match → active source；比赛、session、authority revision、generation、epoch、reliable sequence floor、identity 和 lineup 继续 fail closed。准入信息不能替代数据库授权。
2. **发送仍在上述 share locks 内完成。** LIVE 先持锁，则 revoke/handover/manual command 等待发送返回；mutation 先持锁，则 LIVE 在短锁预算后丢弃，或在下一次请求重新验证新事实。不能用 Promise.race 放弃仍在运行的发送并提前解锁。
3. 比赛级 PostgreSQL try-advisory transaction lock 只排斥其它 LIVE 投递，不改变 mutation 的锁协议；争用立即丢弃，不保存等待帧。安装/比赛/源行锁仍是 authority fence，advisory lock 不是授权。
4. 进程级准入是资源保护，最多两个 LIVE 请求（包括凭据查询和 body read），不排队；不是跨实例 current-state authority。生产池为三连接，因此 LIVE 自身不吃完该池。其它业务和多实例仍须另外做容量预算。
5. 有界的进程内元数据只保留近期已验证投递的 cursor/timestamp/节流时间，不保存 snapshot。每源使用容量 2、每秒补充 2 个令牌的准入预算，吸收合法 2 Hz producer 的到达抖动；不强制接收间隔恰好大于 500ms。跨实例与进程重启不能承诺全局去重：公开 consumer 必须按现有 delivery cursor 与 producedAt 丢弃旧帧/重复帧，相同 gameplay sequence 的较新 heartbeat 合法。
6. 不重试当前帧，不持久化，不补发；过载返回 `accepted:false`，入口满载返回 429。恢复只靠下一份 eligible heartbeat；官方赛果从不消费 LIVE。
7. provider 的 202 只证明接受 HTTP 请求，不证明所有观众已收到。网络 timeout 的结果可能不明；不重试、不宣称取消已经到达 provider 的投递。provider 延迟投递与 viewer reset 仍需真实环境联调。

## 基线

基线与复现、最终对比将在本次隔离运行结束后补齐。原始基线数值见 [JSON](evidence/live-capacity-baseline.json)。
