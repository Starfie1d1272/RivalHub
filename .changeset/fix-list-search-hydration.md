---
"rivalhub": patch
---

修复列表搜索框在首次冷加载 hydration 完成前可能接受输入但没有触发 React `onChange`，导致 URL 搜索状态不更新的问题。
