---
"rivalhub": patch
---

支持新版 Supabase publishable/secret API key，并保留旧配置回退；隔离本地验证环境的密钥，防止特权 key 误用于公开客户端，补齐日志与 CI 产物中的新版密钥脱敏。
