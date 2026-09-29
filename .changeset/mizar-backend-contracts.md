---
"rivalhub": minor
---

Mizar 制播集成收敛为明确的 server-only 边界：赛事管理员在浏览器授权页为一次赛事创建 installation credential，Mizar 之后只能经 provider 读取该赛事的 Tournament Context 与赛程窗口，RivalHub 不下发 Drizzle 行、后台私有 read model、凭据或内部诊断；连接可被 canonical revoke，撤销后凭据立即 fail closed。

Mizar 的可靠事件与实时画面都要先通过 installation、比赛、authority revision、session、generation、map epoch、序列、身份与首发证据校验。可靠事件只是候选：`map_ended` 的 `scoreA`/`scoreB` 是 entrant-relative 候选，`scoreCT`/`scoreT` 仅作证据，正式结果仍由唯一 canonical map result owner 在事务内写入，`series_ended` 不会在没有正式地图结果时推进系列赛。单场同一时刻只有一个 authoritative source，换机接管递增 authority revision 并使旧数据源 fail closed，人工接管只作用于当前地图执行。

公开实时画面只经校验后投射为有硬上限的 public payload，并通过私有 Supabase Realtime Broadcast 投递，不写入 PostgreSQL、不保存历史、不引入 replay store；浏览器只持有单场、短寿命、receive-only 的 viewer token，无 INSERT policy，不能发布可信帧或跨场订阅。
