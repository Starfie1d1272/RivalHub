import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createLocalPool } from "./harness/database";

vi.mock("@/lib/auth/session", () => ({
  requireSuperAdmin: vi.fn().mockResolvedValue({ role: "super_admin" }),
  requireSeasonAdmin: vi.fn().mockResolvedValue({ role: "season_admin" }),
}));

import { fetchAuditLogDetail, fetchAuditLogs } from "@/actions/audit";

import { requireSeasonAdmin, requireSuperAdmin } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";

describe("audit presentation PostgreSQL readback", () => {
  // Canonical joins, scope predicates and DTO privacy require real PostgreSQL;
  // resolver mocks alone cannot catch a wrong relation or omitted WHERE scope.
  it("resolves machine relations and reauthorizes scoped details without exposing stored secrets", async () => {
    const pool = createLocalPool();
    const authorizer = randomUUID();
    const installation = randomUUID();
    const pairing = randomUUID();
    const mizarIntent = randomUUID();
    const dakIntent = randomUUID();
    const season = randomUUID();
    const otherSeason = randomUUID();
    const missing = randomUUID();
    const secret = `private-secret-${randomUUID()}`;
    const meta = { credential: secret, tokenHash: secret, nested: { raw: secret }, reason: secret };
    const rows = [
      ...["match.start", "match.map.start", "match.record_map_result"].map(action => ({ id: randomUUID(), action, actor: installation, season, type: "match", target: missing })),
      { id: randomUUID(), action: "match.start", actor: installation, season: otherSeason, type: "match", target: missing },
      { id: randomUUID(), action: "match.demo.needs_attention", actor: `dak:${pairing}`, season, type: "match_demo_import", target: missing },
      { id: randomUUID(), action: "match.demo.needs_attention", actor: `dak:${pairing}`, season: otherSeason, type: "match_demo_import", target: missing },
      { id: randomUUID(), action: "mizar.installation.revoke", actor: authorizer, season, type: "mizar_installation", target: installation },
      { id: randomUUID(), action: "admin.dak.pair", actor: authorizer, season: null, type: "dak_pairing", target: pairing },
      { id: randomUUID(), action: "mizar.installation.revoke", actor: installation, season, type: "mizar_installation", target: installation },
    ];
    try {
      // A colliding human UUID must not override a proven machine action, or
      // turn unrelated/out-of-scope human facts into machine operations.
      await pool.query("INSERT INTO users (id, email, display_name) VALUES ($1, $2, '设备授权者'), ($3, $4, '同 ID 用户')", [authorizer, `${authorizer}@private.test`, installation, `${installation}@private.test`]);
      await pool.query("INSERT INTO seasons (id, slug, name, kind) VALUES ($1, $1::text, '机器测试赛事', 'custom'), ($2, $2::text, '另一赛事', 'custom')", [season, otherSeason]);
      await pool.query("INSERT INTO mizar_pairing_intents (id, poll_token_hash, expires_at, status, competition_id, authorized_by_user_id, authorized_at) VALUES ($1, $2, now() + interval '1 day', 'authorized', $3, $4, now())", [mizarIntent, `mizar-${secret}`, season, authorizer]);
      await pool.query("INSERT INTO mizar_installations (id, competition_id, pairing_intent_id, authorized_by_user_id, credential_hash, revoked_at) VALUES ($1, $2, $3, $4, $5, now())", [installation, season, mizarIntent, authorizer, secret]);
      await pool.query("INSERT INTO dak_pairing_intents (id, poll_token_hash, expires_at, status, authorized_by_user_id, authorized_at) VALUES ($1, $2, now() + interval '1 day', 'authorized', $3, now())", [dakIntent, `dak-${secret}`, authorizer]);
      await pool.query("INSERT INTO dak_pairings (id, pairing_intent_id, user_id, token_hash, scopes, season_ids) VALUES ($1, $2, $3, $4, ARRAY['demo:submit'], ARRAY[$5::text])", [pairing, dakIntent, authorizer, secret, season]);
      for (const row of rows) {
        await pool.query("INSERT INTO audit_logs (id, season_id, action, actor_id, target_type, target_id, meta) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)", [row.id, row.season, row.action, row.actor, row.type, row.target, JSON.stringify(meta)]);
      }

      const details = [];
      for (const row of rows) {
        const detail = await fetchAuditLogDetail({ id: row.id, ...(row.season ? { seasonScopeId: row.season } : {}) });
        expect(detail.success).toBe(true);
        if (!detail.success) throw new Error(detail.error.message);
        details.push(detail.data);
      }
      for (const detail of details.slice(0, 3)) expect(detail).toMatchObject({ actorLabel: "Mizar", authorizedByLabel: "设备授权者" });
      expect(details[3]).toMatchObject({ actorLabel: "同 ID 用户", authorizedByLabel: null });
      expect(details[4]).toMatchObject({ actorLabel: "DAK Studio", authorizedByLabel: "设备授权者" });
      expect(details[5]).toMatchObject({ actorLabel: "DAK Studio", authorizedByLabel: null });
      expect(details[6]).toMatchObject({ actorLabel: "设备授权者", targetLabel: "Mizar · 机器测试赛事 · 已撤销", targetContext: "设备授权者：设备授权者" });
      expect(details[7]).toMatchObject({ actorLabel: "设备授权者", targetLabel: "DAK Studio · 使用中", targetContext: "设备授权者：设备授权者" });
      expect(details[8]).toMatchObject({ actorLabel: "Mizar", authorizedByLabel: "设备授权者", targetLabel: "Mizar · 机器测试赛事 · 已撤销" });
      const serialized = JSON.stringify(details);
      for (const privateValue of [secret, authorizer, installation, pairing, mizarIntent, dakIntent, "private.test", "credential", "tokenHash", '"meta"']) expect(serialized).not.toContain(privateValue);
      const stored = await pool.query("SELECT actor_id, target_id, meta FROM audit_logs WHERE id = $1", [rows[0]!.id]);
      expect(stored.rows[0]).toEqual({ actor_id: installation, target_id: missing, meta });

      vi.mocked(requireSeasonAdmin).mockClear();
      const crossScope = await fetchAuditLogDetail({ id: rows[0]!.id, seasonScopeId: otherSeason });
      expect(requireSeasonAdmin).toHaveBeenCalledWith(otherSeason);
      expect(crossScope).toMatchObject({ success: false, error: { code: ErrorCode.NOT_FOUND } });
      const globalInSeason = await fetchAuditLogDetail({ id: rows[7]!.id, seasonScopeId: season });
      expect(globalInSeason).toMatchObject({ success: false, error: { code: ErrorCode.NOT_FOUND } });
      vi.mocked(requireSeasonAdmin).mockRejectedValueOnce(new AppError(ErrorCode.FORBIDDEN, "无赛事管理权限"));
      expect(await fetchAuditLogDetail({ id: rows[0]!.id, seasonScopeId: season })).toMatchObject({ success: false, error: { code: ErrorCode.FORBIDDEN } });
      vi.mocked(requireSuperAdmin).mockClear();
      vi.mocked(requireSuperAdmin).mockRejectedValueOnce(new AppError(ErrorCode.FORBIDDEN, "需要超级管理员"));
      expect(await fetchAuditLogDetail({ id: rows[0]!.id })).toMatchObject({ success: false, error: { code: ErrorCode.FORBIDDEN } });
      expect(requireSuperAdmin).toHaveBeenCalledOnce();
      expect((await fetchAuditLogDetail({ id: rows[0]!.id })).success).toBe(true);
    } finally {
      await pool.query("DELETE FROM audit_logs WHERE id = ANY($1::uuid[])", [rows.map(row => row.id)]);
      await pool.query("DELETE FROM mizar_installations WHERE id = $1", [installation]);
      await pool.query("DELETE FROM dak_pairings WHERE id = $1", [pairing]);
      await pool.query("DELETE FROM mizar_pairing_intents WHERE id = $1", [mizarIntent]);
      await pool.query("DELETE FROM dak_pairing_intents WHERE id = $1", [dakIntent]);
      await pool.query("DELETE FROM seasons WHERE id = ANY($1::uuid[])", [[season, otherSeason]]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[authorizer, installation]]);
      await pool.end();
    }
  });

  it("resolves names and deleted targets while preserving private immutable facts", async () => {
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
      { id: randomUUID(), action: "match.delete", actor: "system", type: "match", meta: null },
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
      expect(views.get(rows[6]!.id)).toMatchObject({ actionLabel: "删除比赛", targetTypeLabel: "比赛", targetLabel: "已删除 / 历史目标" });
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
