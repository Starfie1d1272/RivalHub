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

默认 Vitest 集成测试仍以 schema 和纯逻辑校验为主。数据库相关变更还必须先运行 `pnpm db:local:reset`：该命令会在完整 Local Supabase 上重放 Drizzle active migrations、建立 fixture，并实测 Auth、Storage 和 Data API 默认拒绝策略。

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

### Staging 验收

外部试点前需要一套独立 staging 数据库和可复现 seed。当前 `pnpm seed` 只创建 Root 管理员，不足以验收外部试点。

建议新增场景 seed：

| 脚本 | 内容 |
|---|---|
| `seed:rivals` | 个人报名、审核、队长投票、选秀、排位赛、双败淘汰 |
| `seed:permissions` | guest、user、season_admin、super_admin、root 权限矩阵 |
| `seed:major` | 32 队队伍报名、Swiss、单败；当前需等队伍报名和 Major UI 补齐后再做 |
| `seed:demo` | demo 导入 fixture；当前可用于导入链路验收，完整展示等外部分析仓库接入 |
| `seed:broadcast` | broadcast fixture；当前需等 broadcast 模块新增后再做 |

外部试点前最小 staging smoke：

1. 登录。
2. 个人报名。
3. 管理员审核。
4. 队长确认。
5. 选秀 smoke。
6. 生成赛程。
7. 比分录入。
8. demo 管理页可打开。
9. `season_admin` 不能跨赛季操作管理 action。

这些验收不得指向 production `DATABASE_URL`。

`db:local:*` 会在创建 Pool 或执行 CLI 写命令前验证 loopback。以下负向测试应始终失败，且不得发生网络连接：

```bash
RIVALHUB_LOCAL_DATABASE_URL='postgresql://user:pass@db.example.com:5432/postgres' \
  pnpm exec drizzle-kit migrate --config=drizzle.local.config.ts
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
