---
"rivalhub": minor
---

逐图记分板、OCR/手填数据与 DAK gameplay facts 收敛为字段级明确的赛后所有权：单图具备正式比分与完成时间后即可确认该图数据，不必等待整场系列赛结束；OCR 只拥有 Rating / RWS / WE，不得覆盖 DAK 的 K/D/A、ADR、HS、FK、MK、残局等 gameplay facts，DAK 晋级也不清空已有 Rating / RWS / WE。清除计分板输入改为只删除仅由 OCR 持有的行并清空 DAK 行的 Rating / RWS / WE，保留 Demo lineage 与确认事实；后台编辑器读取改由 server-only 读模型返回 sanitized DTO，并按赛季显式授权，不再向浏览器下发 DAK lineage 与审核字段。
