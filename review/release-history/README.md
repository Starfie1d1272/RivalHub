# GitHub Release 历史审查材料（未完成）

- `releases-original.json` 为 GitHub Releases API 全量快照，包含正文及非正文元数据和资产清单。读取于 2026-10-30 UTC；快照包含 203 个 Release，资产列表均为空。写入前须重新读取并比较原正文哈希、元数据及资产，避免覆盖并发修改。
- `candidates.json` 为每个已存在 Release 保存原正文 SHA-256 和候选正文。`changed-review-required` 的 7 项仅与本次已修改的 CHANGELOG 条目同步，仍需独立审阅；`unchanged-unreviewed` 的 196 项只是原文备份，尚非经过审阅的最终候选。不得据此批量更新远端。
- 未创建 Release 或 tag，亦未修改任何远端 Release。比较链接、生产基线、安装/兼容/安全说明和任何既有资产均须逐版核查保留。
- 日期证据不能混同：如 1.26.1、1.26.2 和 1.30.0 的 GitHub Release 发布时间晚于现有日志日期，不能仅凭 Release 创建日期覆盖历史日期。
- 尚未完成全部 218 个日志版本的事实、遗漏、分类和文案审阅；此材料仅为可恢复的中间结果。
