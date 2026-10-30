# GitHub Release 历史审查材料（未完成）

- `releases-original.json` 为 GitHub Releases API 全量快照，包含正文及非正文元数据和资产清单。读取于 2026-10-30 UTC；快照包含 203 个 Release，资产列表均为空。写入前须重新读取并比较原正文哈希、元数据及资产，避免覆盖并发修改。
- `audit-1.21-1.30.md` 记录 1.21 至 1.30 的版本证据及标签异常。
- `audit-2.0-2.9.md` 记录早期 2.x 版本的证据与处理。
- `audit-2.10-2.18.md` 记录上一批版本的证据与处理。
- `audit-2.19-2.24.md` 记录本批逐版比较区间、提交和 Release 处理。
- `inventory.md` 按 218 个日志版本列出 tag commit、原日志日期和 GitHub Release 快照时间；索引不是内容审阅。
- `candidate-diffs.md` 展示 已变更的正文候选与原文的逐行差异。
- `candidates.json` 为每个已存在 Release 保存原正文 SHA-256 和候选正文。`changed-review-required` 为有修改且待独立审阅的候选；`reviewed-unchanged` 为本批核对后保留原文；`unchanged-unreviewed` 尚未审阅。不得据此批量更新远端。
- 未创建 Release 或 tag，亦未修改任何远端 Release。比较链接、生产基线、安装/兼容/安全说明和任何既有资产均须逐版核查保留。
- 日期证据不能混同：如 1.26.1、1.26.2 和 1.30.0 的 GitHub Release 发布时间晚于现有日志日期，不能仅凭 Release 创建日期覆盖历史日期。
- 尚未完成全部 218 个日志版本的事实、遗漏、分类和文案审阅；此材料仅为可恢复的中间结果。
