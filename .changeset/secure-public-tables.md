---
"rivalhub": patch
---

收口 public 数据库访问边界：业务表统一启用 RLS 并撤销匿名/登录角色的 Data API privileges，移除无效业务表 Realtime 订阅并保留选秀与投票的轮询刷新。
