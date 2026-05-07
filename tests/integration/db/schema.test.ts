import { describe, it, expect } from "vitest";

// hello-world 集成测试桩
// TODO: Phase 2 后替换为真实 DB 连接测试
// 将使用 Supabase local 或 testcontainers + Drizzle schema push

describe("DB schema (stub)", () => {
  it("schema 模块可正常导入", async () => {
    // 验证所有 schema 文件可被 import 而不抛出错误
    const schema = await import("@/db/schema");
    expect(schema).toBeDefined();
    expect(schema.users).toBeDefined();
    expect(schema.seasons).toBeDefined();
    expect(schema.seasonRegistrations).toBeDefined();
    expect(schema.teams).toBeDefined();
    expect(schema.teamMembers).toBeDefined();
    expect(schema.captainVotes).toBeDefined();
    expect(schema.draftState).toBeDefined();
    expect(schema.draftPicks).toBeDefined();
    expect(schema.matches).toBeDefined();
    expect(schema.auditLogs).toBeDefined();
  });
});
