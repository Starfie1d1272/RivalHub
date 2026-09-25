---
"rivalhub": patch
---

收口 Steam profile runtime contract 为 steam_profiles 单一持久化事实来源，停止对 users 物理表中 legacy shadow 列（steam_name、steam_profile_url、avatar_url）的运行时写操作与维护；在 Demo review 中为观察到的 Steam64 提供官方资料投影与优雅降级；修复玩家头像直连 Steam CDN（unoptimized）。
