import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createLocalPool } from "./harness/database";

vi.mock("@/lib/auth/session", () => ({
  requireSuperAdmin: vi.fn().mockResolvedValue({ role: "super_admin" }),
  requireSeasonAdmin: vi.fn().mockResolvedValue({ role: "season_admin" }),
}));

import { fetchAuditLogs } from "@/actions/audit";

describe("audit presentation PostgreSQL readback", () => {
  it("resolves actor and allowlisted context names while preserving immutable facts", async () => {
    const pool = createLocalPool();
    const alice = randomUUID();
    const bob = randomUUID();
    const missing = randomUUID();
    const rows = [
      { id: randomUUID(), action: "team.captain.transfer", actor: alice, type: "team", meta: { fromUserId: alice, toUserId: bob, emergencyOverride: true } },
      { id: randomUUID(), action: "competition_entry.representative.transfer", actor: `${alice}@local.test`, type: "competition_entry", meta: { fromUserId: missing, toUserId: bob } },
      { id: randomUUID(), action: "sanction.issue", actor: "system:discipline", type: "disciplinary_case", meta: { subjectUserId: bob, reason: "private reason" } },
      { id: randomUUID(), action: "user_identity.merge", actor: "release:private-deployment", type: "user", meta: { mergedUserId: alice, summary: { AUTOMATIC: 4, PRESERVE: 2 }, evidenceClass: "private evidence" } },
      { id: randomUUID(), action: "match.demo.needs_attention", actor: "dak:private-pairing", type: "match_demo_import", meta: { mapOrder: 2, playerCount: 10, issueCount: 2, token: "private token" } },
      { id: randomUUID(), action: "match.import_demo", actor: "future:private-token", type: "match_map", meta: null },
    ];
    try {
      await pool.query("INSERT INTO users (id, email, display_name) VALUES ($1, $2, 'Alice'), ($3, $4, 'Bob')", [alice, `${alice}@local.test`, bob, `${bob}@local.test`]);
      for (const row of rows) {
        await pool.query("INSERT INTO audit_logs (id, action, actor_id, target_type, target_id, meta, created_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, '2050-01-01T12:00:00Z')", [row.id, row.action, row.actor, row.type, missing, JSON.stringify(row.meta)]);
      }
      const result = await fetchAuditLogs({ dateFrom: "2050-01-01", dateTo: "2050-01-01", pageSize: 100 });
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error.message);
      const views = new Map(result.data.logs.map((row) => [row.id, row]));
      expect(views.get(rows[0]!.id)).toMatchObject({ actorLabel: "Alice", summary: "队长：Alice → Bob · 管理员紧急转移" });
      expect(views.get(rows[1]!.id)).toMatchObject({ actorLabel: "Alice", summary: "赛事代表：未知用户 → Bob" });
      expect(views.get(rows[2]!.id)).toMatchObject({ actorLabel: "系统", summary: "处罚对象：Bob" });
      expect(views.get(rows[3]!.id)).toMatchObject({ actorLabel: "发布流程", summary: "合并来源：Alice · 合并记录 4 · 保留历史记录 2" });
      expect(views.get(rows[4]!.id)).toMatchObject({ actorLabel: "DAK Studio", targetTypeLabel: "Demo 数据", targetLabel: "记录未找到", summary: "第 2 图 · 选手 10 · 待处理问题 2" });
      expect(views.get(rows[5]!.id)).toMatchObject({ actorLabel: "未知来源", actionLabel: "导入 Demo 数据", targetTypeLabel: "比赛地图" });
      const presentation = JSON.stringify(rows.map((row) => views.get(row.id)));
      for (const secret of [alice, bob, missing, "private", "local.test"]) expect(presentation).not.toContain(secret);
      const stored = await pool.query("SELECT actor_id, target_id, meta FROM audit_logs WHERE id = $1", [rows[4]!.id]);
      expect(stored.rows[0]).toEqual({ actor_id: "dak:private-pairing", target_id: missing, meta: rows[4]!.meta });
    } finally {
      await pool.query("DELETE FROM audit_logs WHERE id = ANY($1::uuid[])", [rows.map((row) => row.id)]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[alice, bob]]);
      await pool.end();
    }
  });
});
