---
"rivalhub": patch
---

将生产环境定时任务请求的 trace 采样率设为 5%，保留其他请求及 Preview 的完整 trace 和所有结构化错误日志；补齐查询重试期间连接池重建失败的告警事件，并明确 Better Stack 基于真实故障事件的告警与验收规则。
