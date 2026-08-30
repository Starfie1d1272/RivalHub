---
"rivalhub": patch
---

收敛生产与开发依赖的已知安全风险：升级 drizzle-orm、Supabase 与 tsx，移除未使用的 vercel CLI，并对受上游 pin 限制的传递依赖（postcss、sharp、uuid、vite、js-yaml、brace-expansion、esbuild）使用精确实例的受限兼容策略；不改变赛事领域数据或产品行为。
