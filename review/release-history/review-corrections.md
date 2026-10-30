# 复审修正证据

本轮只修改日志和 Release 候选，未写入任何远端 Release。下列变更仍待原独立审阅者复核。

- 1.20.4 标签指向 [966ca757](https://github.com/Starfie1d1272/RivalHub/commit/966ca7579f166734972e749a6f5f529a78c10c31)，包含连接池重建后的重试；1.20.5 指向 [c8217d85](https://github.com/Starfie1d1272/RivalHub/commit/c8217d85b59cc7b323df86f2d19fbe38412ff0a9)，增加 OCR 60 秒超时。两版日志及已有 Release 候选已分别调整。
- 1.3.0 包含 [6178c9f6](https://github.com/Starfie1d1272/RivalHub/commit/6178c9f68be1985f36e93777b2317acb36940433) 和 [c23f400a](https://github.com/Starfie1d1272/RivalHub/commit/c23f400a32a8bfd007dd619c2c3fbeb7cdec88b4)；协商自动裁定、队长改名和选秀选手主页链接已从 1.2.0 移至 1.3.0 及其 Release 候选。1.2.0 无 Release，不创建。
- 2.9.7 候选按复审提供的生产基线 v2.9.5 包含 2.9.6 的运营概览与 [#661](https://github.com/Starfie1d1272/RivalHub/commit/686ea1741af8c504121678da4a650011f0c8222e) 发布切流修复，并明确中间条目不代表独立上线。[发布作业](https://github.com/Starfie1d1272/RivalHub/actions/runs/34990065431/job/104452105211)元数据可读且显示成功；本线程下载该作业日志时 GitHub 返回 Forbidden，因此前版值依赖复审报告，需由可读取日志的复审者再次核实。
- v1.26.1 现存标签指向 1.30.1；候选现直接附上 v1.26.0 到当时 1.26.1 提交的比较链接，未移动标签。
- 1.29.0 保留高级 / Demo 排行榜排序和 full 经济类别统计修复，删除内部导入、导出及 JSON 语法细节；1.25.0 保留赛季状态操作及报名状态限制，删除文档行数和类型导入等内部清理。
- 1.23.0 的 tag 包含 `drizzle/migrations/0019_is_forfeit.sql`，且 migration journal 包含对应条目；日志及候选明确升级需要该迁移，不沿用旧 `db:push` 指令。
- 候选保留原 RC 文本中的提交标识 [b2b7ae4](https://github.com/Starfie1d1272/RivalHub/commit/b2b7ae4c403152a36ce8384e47de51ea49e26498)、[dabc985](https://github.com/Starfie1d1272/RivalHub/commit/dabc985fc085fd57e7cb34166bcbf46647e62b69)、[ed1f9cb](https://github.com/Starfie1d1272/RivalHub/commit/ed1f9cb002509df89830d1161307e21fcf3dc834) 并链接到完整提交。针对所有原正文检查 7–39 位十六进制短标识，未发现其他被移除的短 SHA。
- [de87d7f3](https://github.com/Starfie1d1272/RivalHub/commit/de87d7f3dab3f1f8542b3541bc544b31daae8579) 的空赛季首页修复已包含在 v1.0.2，且 v1.0.2 到 v1.1.0 的首页文件无差异；说明从 1.1.0 移回 1.0.2。两个版本均无 Release，不创建。
