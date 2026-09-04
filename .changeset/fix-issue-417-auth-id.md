---
"rivalhub": patch
---

修复重复注册已确认账号时错误绑定 `auth_id` 的问题，并将注册结果统一为不泄露账号状态的账号设置提示；同时安全修复历史 dangling identity mapping。
