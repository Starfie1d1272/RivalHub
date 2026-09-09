---
"rivalhub": patch
---

修复 Supabase primary scheduler 无法实际派发任务的问题，并让发布验证确认真实 dispatch、endpoint success 与分钟级调度执行后才完成。
