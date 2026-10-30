# GitHub Release 历史审查材料（未完成）

- `releases-original.json` 为 GitHub Releases API 全量快照，包含正文及非正文元数据和资产清单。读取于 2026-10-30 UTC；快照包含 203 个 Release，资产列表均为空。写入前须重新读取并比较原正文哈希、元数据及资产，避免覆盖并发修改。
- `audit-1.0-1.20.md` 记录最早版本的证据与处理。
- `audit-1.21-1.30.md` 记录 1.21 至 1.30 的版本证据及标签异常。
- `audit-2.0-2.9.md` 记录早期 2.x 版本的证据与处理。
- `audit-2.10-2.18.md` 记录上一批版本的证据与处理。
- `audit-2.19-2.24.md` 记录本批逐版比较区间、提交和 Release 处理。
- `inventory.md` 按 219 个日志版本列出 tag commit、原日志日期和 GitHub Release 快照时间；索引不是内容审阅。
- `candidate-diffs.md` 展示已变更的正文候选与原文的逐行差异。
- `candidates.json` 为每个已存在 Release 保存原正文 SHA-256 和候选正文。`changed-review-required` 为有修改且待独立审阅的候选；`reviewed-unchanged` 为本批核对后保留原文；`unchanged-unreviewed` 尚未审阅。不得据此批量更新远端。
- 未创建 Release 或 tag，亦未修改任何远端 Release。候选保留了原有 URL、完整 SHA、生产基线及安全和兼容说明；正式写入前仍须独立复核。
- 日期证据不能混同：如 1.26.1、1.26.2 和 1.30.0 的 GitHub Release 发布时间晚于现有日志日期，不能仅凭 Release 创建日期覆盖历史日期。
- 已按版本段对照日志、版本区间及 Release 快照；候选仍需独立审阅。2.25.0 的正式发布进行中，快照时尚无对应 Release，发布完成后应重新读取并补充候选。
