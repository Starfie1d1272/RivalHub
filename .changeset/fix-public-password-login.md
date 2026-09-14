---
"rivalhub": patch
---

修复密码登录错误复用高权限 Supabase service client 的问题，改为使用面向用户认证的 public auth client，以兼容新的 Supabase publishable / secret key 模型。
