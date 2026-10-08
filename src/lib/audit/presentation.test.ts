import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AUDIT_ACTION_KEYS,
  AUDIT_EVENT_REGISTRY,
  getAuditActionFilterOptions,
  getAuditActionPresentation,
  getAuditTargetTypeLabel,
  summarizeAuditMeta,
  type AuditAction,
} from "@/lib/audit/presentation";

describe("audit presentation owner", () => {
  it("retains observed legacy actions only on the read side", () => {
    const legacy = {
      "announcement.import_release_history": "导入历史发布公告",
      "identity.merge_preflight.remediation": "修复身份合并预检数据",
      "identity.steam64.remediation": "修复 Steam64 身份资料",
      "match.roster.correction": "修正比赛阵容",
      "match.import_demo": "导入 Demo 数据",
      "match.admin_update_roster": "管理员调整比赛阵容",
      "season.recompute_ratings": "重新计算赛季 Rating",
      "season.rollback_to_voting": "将赛季恢复到队长投票阶段",
    } as const;
    expectTypeOf<Extract<AuditAction, keyof typeof legacy>>().toEqualTypeOf<never>();
    for (const [action, label] of Object.entries(legacy)) {
      expect(getAuditActionPresentation(action)).toMatchObject({ known: true, label });
      expect(getAuditActionFilterOptions()).toContainEqual(expect.objectContaining({ value: action, label }));
    }
  });

  it("summarizes Demo problems and merge counts without technical evidence", () => {
    expect(summarizeAuditMeta("match.demo.needs_attention", {
      mapOrder: 2, playerCount: 10, issueCount: 2, issues: ["PARTICIPANT_NOT_IN_ROSTER"],
    })).toBe("第 2 图 · 选手 10 · 待处理问题 2");
    expect(summarizeAuditMeta("user_identity.merge", {
      summary: { AUTOMATIC: 12, PRESERVE: 3, BLOCKER: 0, secret: "secret" },
      planFingerprint: "private-fingerprint", evidenceClass: "private-class",
    })).toBe("合并记录 12 · 保留历史记录 3");
    expect(summarizeAuditMeta("team.captain.transfer", { emergencyOverride: true })).toBe("管理员紧急转移");
  });
  it("derives filter options from the same action source", () => {
    const options = getAuditActionFilterOptions();
    expect(options.map((option) => option.value)).toEqual(AUDIT_ACTION_KEYS);
  });

  it("retains canonical non-default targets in the registry", () => {
    expect(AUDIT_EVENT_REGISTRY["conversion_policy.approve"].target).toMatchObject({ type: "conversion_policy", lifecycle: "stable" });
    expect(AUDIT_EVENT_REGISTRY["major.swiss.finalize_round"].target).toMatchObject({ type: "major_stage_run", lifecycle: "stable" });
    expect(AUDIT_EVENT_REGISTRY["match.generate_schedule"].target).toMatchObject({ type: "season", lifecycle: "stable" });
    expect(AUDIT_EVENT_REGISTRY["match.delete"].target).toMatchObject({ type: "match", lifecycle: "tombstone" });
    expect(AUDIT_EVENT_REGISTRY["match.demo.identity_confirm"].target).toMatchObject({ type: "match_demo_import", lifecycle: "stable" });
    expect(AUDIT_EVENT_REGISTRY["match.demo.identity_retire"].target).toMatchObject({ type: "user_gameplay_steam_id", lifecycle: "stable" });
  });

  it("uses a human fallback for unknown actions", () => {
    const presentation = getAuditActionPresentation("future.internal_action");
    expect(presentation).toMatchObject({ label: "未知操作", categoryLabel: "其他", known: false });
    expect(presentation.label).not.toContain("future.internal_action");
  });

  it("summarizes only approved low-sensitivity metadata", () => {
    const summary = summarizeAuditMeta("match.record_result", {
      scoreA: 1,
      scoreB: 0,
      token: "secret-token",
      evidenceCode: "secret-code",
      internalEvidence: "private evidence",
      reason: "private reason",
      note: "private note",
      email: "player@example.test",
    });
    expect(summary).toContain("比分 1:0");
    expect(summary).not.toContain("secret-token");
    expect(summary).not.toContain("secret-code");
    expect(summary).not.toContain("private evidence");
    expect(summary).not.toContain("private reason");
    expect(summary).not.toContain("private note");
    expect(summary).not.toContain("player@example.test");

    const reviewSummary = summarizeAuditMeta("education_verification.approved", { reviewNote: "内部审核材料" });
    expect(reviewSummary).toBe("已记录");
    expect(reviewSummary).not.toContain("内部审核材料");
    expect(summarizeAuditMeta("education_verification.approved", { reviewNote: true })).toBe("含审核备注");
    const identitySummary = summarizeAuditMeta("match.demo.identity_confirm", {
      playerName: "选手甲",
      observedSteam64: "76561198000000001",
      actorId: "internal-id",
    });
    expect(identitySummary).toContain("选手 选手甲");
    expect(identitySummary).toContain("Steam64 76561198000000001");
    expect(identitySummary).not.toContain("internal-id");
  });

  it("keeps target categories readable without exposing raw type keys", () => {
    expect(getAuditTargetTypeLabel("education_verification")).toBe("教育认证");
    expect(getAuditTargetTypeLabel("major_final_result")).toBe("Major 最终赛果");
    expect(getAuditTargetTypeLabel("future_target")).toBe("其他对象");
  });
});
