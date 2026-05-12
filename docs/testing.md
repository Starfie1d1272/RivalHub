# 测试策略

## 测试栈

| 类型 | 工具 | 配置文件 |
|---|---|---|
| 单元 / 集成 | Vitest + React Testing Library + jsdom | `vitest.config.ts` |
| E2E | Playwright | `playwright.config.ts` |
| 覆盖率 | `@vitest/coverage-v8` | vitest.config.ts |

---

## 三层测试边界

### 单元测试（`tests/unit/`）

**什么测**：
- `src/lib/validators/` — Zod schema 校验逻辑（合法/非法输入各种组合）
- `src/lib/utils/date.ts` — UTC ↔ Asia/Shanghai 转换
- `src/lib/utils/season.ts` — slug 解析、赛季状态判断
- `src/lib/utils/cn.ts` — class merge 工具（trivial，可选）

**什么不测**：
- DB 查询（不 mock Drizzle，改用集成测试）
- Server Actions 完整链路（用集成测试）
- 页面级渲染（用 E2E）

```
tests/unit/
├── lib/
│   ├── validators.test.ts
│   ├── date.test.ts
│   └── season.test.ts
└── actions/
    └── actions/                 # 少量 Server Action 状态迁移测试
```

### 集成测试（`tests/integration/`）

**什么测**：
- Drizzle schema 结构与 DB 一致性
- Server Action 完整链路（mock Supabase，用真实 SQL in-memory 或 testcontainers）

当前集成测试以 schema 和纯逻辑校验为主，不启动真实 Supabase。完整 Server Action 链路由上线前手动冒烟覆盖。

```
tests/integration/
└── db/
    └── schema.test.ts         # 验证 Drizzle schema 生成的迁移 SQL 结构正确
```

### E2E 测试（`tests/e2e/`）

**什么测**：关键业务路径的完整流转，跑在真实（或 staging）浏览器。

**关键路径（上线验收）**：
1. 首页访问 → 赛季卡片跳转
2. 报名表单填写 → 提交成功
3. 管理员登录 → 审核通过一条报名
4. 投票流程 → 确认队长
5. 选秀流程（简化版，跳过真实倒计时）
6. 比赛录入 → 赛程页显示结果

```
tests/e2e/
└── flows/
    └── home.spec.ts           # 当前已有首页 smoke
```

---

## Vitest 配置要点

```typescript
// vitest.config.ts
{
  test: {
    environment: "jsdom",        // 模拟浏览器 DOM
    setupFiles: ["./tests/setup.ts"],
    globals: true,               // describe/it/expect 全局可用
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/integration/**/*.test.ts",
    ],
    exclude: ["tests/e2e/**"],   // e2e 由 Playwright 单独跑
  }
}
```

`tests/setup.ts` 全局引入：
- `@testing-library/jest-dom`（扩展 expect matcher：`toBeInTheDocument` 等）

---

## Playwright 配置要点

```typescript
// playwright.config.ts
{
  testDir: "./tests/e2e",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
}
```

---

## CI 触发规则

`.github/workflows/ci.yml` 已配置，在 `push`（main/dev）和 `pull_request`（main/dev）时触发：

```yaml
steps:
  - pnpm install --frozen-lockfile
  - pnpm tsc --noEmit
  - pnpm test           # Vitest
  - pnpm build
```

E2E 测试（Playwright）当前未纳入 CI。上线前需要人工或 staging 冒烟覆盖：注册/登录、报名、审核、投票、选秀、赛程录分。

---

## 覆盖率目标

**v1 不强制覆盖率**，但建议：
- `src/lib/validators/` ≥ 90%
- `src/lib/utils/` ≥ 80%
- `src/actions/` ≥ 60%（集成测试覆盖）

Phase 2+ 每个新 Server Action 必须有对应测试用例。
