# 后台最后两项有界浏览器证据

重跑结果会另记实际checkout的commit/tree；reference字段仅指本次原采样。源 main `3830c0467d6811e426bf8787238d17d85a1b7d0f`，tree `39199e89d8a98006afa17d97ca5d4656958fea39`。隔离 worktree 的运行源码与此 tree 一致。只使用 loopback PostgreSQL、Local Supabase、Chromium 和 HTTPS fixture；没有生产读写、永久凭据或生产配置变化。结果见 [results.json](results.json)。

## 工作台辅助 provider 延迟

同一 canonical prediction fixture、同一管理员与 scheduled match，先暖路线，再换一个 cache-miss Bilibili room。唯一延迟请求等待3000ms，现有adapter在2500ms超时并显示“无法确认”。provider URL临时指向loopback，telemetry bootstrap仅在实验中使用本地签发配置；数据库环境和授权门禁保持local，没有绕过preview数据库校验。

| 测量 | 暖基线 | 一次延迟 |
| --- | ---: | ---: |
| 核心可见 DOM | 664.1ms | 663.9ms |
| 实际 admin/primary ready事件 | 1143ms | 700ms |
| 辅助状态可见 DOM | 664.2ms | 2850ms |
| CLS，标准session-window且排除recent input | 0.0002093 | 0.0001655 |

延迟期间fallback实际可见，Client“判负弃赛”展开后输入框已可见，而辅助状态仍未出现；未提交弃赛或任何比赛业务mutation。主任务保留“核对首发并进入BP”，没有以辅助未加载替代authority事实。延迟请求计数为1。现有工作台没有advanced产品marker，表中的advanced仅为真实可见辅助内容里程碑；没有添加marker或改生产实现。

Primary是现有producer实际产生的ready事件：本地bootstrap保留签名/identity/measurementVersion流程，测试拦截批次发送并催发既有queue，不伪造ready。它不验证生产receiver接收。首次采样曾在producer默认60秒flush时机等待；最终脚本只催发已存在队列。基线和延迟例的交互不同、均为单样本，不能据两个数值宣称改善比例或p75/p95。

## Telemetry最大合法响应体profile

实际浏览器以超级管理员请求`/admin/telemetry?hours=168`，真实server reader向loopback HTTPS的`/admin/analysis`请求1次。返回体通过现有AnalysisData校验，恰好1,048,576字节，达到server transport上限。合成DTO不等于Worker/D1读取2000个真实batch：meta中的2000 batch/2MiB只标识该合成边界，未进行D1容量或并发实验。

数组规模：routes200、operations300、variants2000、filterRows2000、performanceRoutes1200、metricSegments2919、errorGroups100、sessions100、timeline100、release options2000。所有数组cap不能同时填满，因为1MiB响应限制更早生效；fixture用有内容的行填充剩余预算，仅最后不足一行的尾数补入合法detail字符串。它检验response-contract边界，不声称是自然生产流量能同时产生的维度组合。

| 可见状态 | DOM元素 | 观测JS heap | 自动化交互到两帧后 |
| --- | ---: | ---: | ---: |
| 初始overview | 412 | 24.79MiB | — |
| 使用行为 | 9266 | 52.98MiB | 2000.2ms |
| 页面性能 | 6030 | 69.89MiB | 723.6ms |
| 异常与拒绝 | 1044 | 80.09MiB | 455.9ms |
| 采集状态 | 261 | 72.77MiB | 166.0ms |
| 返回overview | 408 | 63.84MiB | 229.2ms |
| 版本下拉2001项（含“全部”） | 6449 | 154.15MiB | 3659.7ms |

所有tab均验证active状态，版本下拉验证2001个真实option，随后发出Escape。采样中最大long task2171ms，累计9次long task；最后CDP TaskDuration8.199671s（about:blank基线0.008639s）、ScriptDuration5.752516s、LayoutDuration0.263674s。CPU profile采样13349点/14.133972s；profile总时长不是CPU忙时。上限fixture有明显停顿，但没有观察到页面无法继续交互的功能阻断；未据此追加虚拟化或其它实现。

这是桌面Chromium、Next development单样本，未限制CPU/网络；交互耗时包含自动化调度与两帧，不能当INP。heap是未强制GC的observed used heap，不是retained heap或泄漏证据。生产LCP/INP、pool/cost及旧无栈异常仍需发布后的cohort证据。

## 历史记录

一次性验收脚本、临时补丁和配置已移除；下述结果保留为历史记录，不可直接复跑。原始 trace 和凭据未存入归档。

实际工作台数据来自修正flush后的单次延迟运行；telemetry因首次fixture路径写错而修正为`/admin/analysis`，之后只跑telemetry部分，保留前一工作台结果。最终telemetry部分24.9秒通过，retry=0；没有把失败的实验设置算成产品回归，也没有放宽功能断言。
