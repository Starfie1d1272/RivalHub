---
"rivalhub": patch
---

收口 v2.2.4 发布前稳定性：将认证/报名工作区明确标记为 request-bound，避免 Cache Components 对私有状态做 instant navigation 校验；Major 报名 E2E 改为等待 canonical 页面状态，消除流式 RSC 下的瞬时探测竞态；地图熟练度保存改为原子 upsert，避免并发首次保存主键竞争。
