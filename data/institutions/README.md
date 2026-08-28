# 教育部高校目录快照（2026）

`moe-2026.csv` 是运行时 canonical `institutions` 的版本化输入；迁移
`0008_youthful_phalanx.sql` 以确定性 UUID 将全部 3,196 所大陆高校写入数据库。

- 官方公告：[教育部《全国高等学校名单》](https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/A03/202606/t20260618_1441074.html)，发布于 2026-06-18，名单截至 2026-06-17。
- 普通高等学校 XLS：`29c40f083b639888e429cf40b68f9a75782d1ce81131c99aabca65b65b36eaea`
- 成人高等学校 XLS：`34765edba0ceda935ca7d4455bc2eb105b94eee8d8d4d7c9150fba327cf11bbf`
- 规范化 CSV SHA-256：`7479efe7543b9a9c9692792e80402af2ffb8dbec79e2afa5639a0dab32a4055f`

未来更新必须新增快照与新的 idempotent Drizzle migration；迁移执行期间不访问教育部网站。
