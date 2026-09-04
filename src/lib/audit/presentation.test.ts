import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTION_DEFINITIONS,
  AUDIT_ACTION_KEYS,
  getAuditActionFilterOptions,
  getAuditActionPresentation,
  getAuditTargetTypeLabel,
  summarizeAuditMeta,
} from "@/lib/audit/presentation";

const CURRENT_PRODUCER_ACTIONS = [
  "admin.create_invite", "admin.deactivate_invite", "admin.revoke_role",
  "registration.submit", "registration.pending", "registration.approved", "registration.rejected", "registration.waitlisted",
  "captain.cast_vote", "captain.retract_vote", "captain.confirm",
  "draft.start", "draft.pick", "draft.skip_turn", "draft.pause", "draft.resume",
  "match.generate_schedule", "match.initialize_stage", "match.create", "match.record_result", "match.record_map_result",
  "match.save_player_stats", "match.delete_player_stats", "match.status_update", "match.start", "match.roster.submit",
  "match.roster.admin_select", "match.roster.confirm", "match.roster.unlock", "match.save_veto", "match.propose_time",
  "match.respond_time_proposal", "match.force_set_time", "match.auto_accept_proposal_timeout", "match.auto_award_time",
  "match.update_scheduled_at", "match.update_completion_deadline", "match.batch_set_completion_deadline", "match.correct_score",
  "match.correct_map_score", "match.delete", "match.forfeit", "update_match_completed_at", "match.result.corrected",
  "match.managed.invalidated", "match.recovery.adjudicated",
  "season.create", "season.update", "season.publish", "season.deleted", "season.revert_to_draft", "season.revert_to_registration",
  "season.force_finish", "season.archive", "season.auto_advance", "season.auto_finish", "season.registration_open",
  "team.create", "team.update_profile", "team.logo.update", "team.invite", "team.invite.accept", "team.invite.decline",
  "team.invite.revoke", "team.membership.status_change", "team.membership.leave", "team.membership.kick", "team.captain.transfer", "team.disband",
  "competition_entry.create", "competition_entry.participant.reinvite", "competition_entry.participant.confirm",
  "competition_entry.participant.withdraw", "competition_entry.participant.decline", "competition_entry.roster.save",
  "competition_entry.roster_change.request", "competition_entry.withdraw", "competition_entry.submit", "competition_entry.submitted",
  "competition_entry.changes_requested", "competition_entry.waitlisted", "competition_entry.approved", "competition_entry.rejected",
  "competition_entry.withdrawn", "competition_entry.representative.transfer", "competition_entry.restriction_override.grant",
  "competition_entry.restriction_override.revoke",
  "user.change_password", "user.claim_invite", "user.owner_bootstrap",
  "education_verification.submit", "education_verification.institutional_email", "education_verification.approved", "education_verification.rejected",
  "competitive_platform.update", "competitive_platform_season.create", "competitive_platform_season.update",
  "competitive_platform_season.set_active", "competitive_platform_season.set_current", "competitive_platform_season.move",
  "competitive_platform_season.delete", "competitive_platform_rank.create", "competitive_platform_rank.rename",
  "competitive_platform_rank.move", "competitive_platform_rank.delete", "competitive_profile.self_declare", "competitive_roles.self_declare",
  "major.start", "major.archive", "major_prestart.add_entrant", "major_prestart.remove_entrant", "major_prestart.save_roster",
  "major_prestart.confirm_roster", "major_prestart.reopen_roster", "major_prestart.add_issue", "major_prestart.resolve_issue",
  "major_prestart.lock_entrants", "major_prestart.save_tournament_seeds", "major_prestart.confirm_tournament_seeds",
  "major.swiss.finalize_round", "major.stage.transition", "major.playoff.start", "major.playoff.finalize_round",
  "major.result.pending_confirmation", "major.result.confirm", "major.stage.finalized_round.revoked",
  "postevent.adjudication.create", "postevent.adjudication.revoke", "postevent.honor.grant", "postevent.honor.revoke",
  "postmatch.commentator.add", "postmatch.commentator.remove", "postmatch.video.update", "postmatch.report.submit", "postmatch.report.revoke",
  "community_award.submit", "community_award.revise", "community_award.request_supplement", "community_award.withdraw",
  "community_award.evidence.submit", "community_award.approved", "community_award.rejected", "community_award.awarded",
  "community_award.not_awarded", "community_award.cancelled",
  "sanction.issue", "sanction.revoke", "sanction.expire",
  "recruitment.team.upsert", "recruitment.team.create", "recruitment.team.close", "recruitment.player.upsert",
  "recruitment.player.create", "recruitment.player.close", "recruitment.interest.create", "recruitment.interest.withdraw", "recruitment.interest.dismiss",
] as const;

describe("audit presentation owner", () => {
  it("keeps every current producer action readable", () => {
    for (const action of CURRENT_PRODUCER_ACTIONS) {
      const presentation = getAuditActionPresentation(action);
      expect(AUDIT_ACTION_DEFINITIONS[action]).toBeDefined();
      expect(presentation.known).toBe(true);
      expect(presentation.label).not.toBe(action);
      expect(presentation.categoryLabel).not.toBe("其他");
    }
  });

  it("derives filter options from the same action source", () => {
    const options = getAuditActionFilterOptions();
    expect(options.map((option) => option.value)).toEqual(AUDIT_ACTION_KEYS);
    expect(options.some((option) => option.value === "education_verification.approved")).toBe(true);
    expect(options.some((option) => option.value === "competitive_profile.self_declare")).toBe(true);
  });

  it("uses a human fallback for unknown actions", () => {
    const presentation = getAuditActionPresentation("future.internal_action");
    expect(presentation).toMatchObject({ label: "未知操作", categoryLabel: "其他", known: false });
    expect(presentation.label).not.toContain("future.internal_action");
  });

  it("summarizes only approved low-sensitivity metadata", () => {
    const summary = summarizeAuditMeta("match.record_result", {
      scoreA: 13,
      scoreB: 9,
      token: "secret-token",
      evidenceCode: "secret-code",
      internalEvidence: "private evidence",
      reason: "private reason",
      note: "private note",
      email: "player@example.test",
    });
    expect(summary).toContain("比分 13:9");
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
  });

  it("keeps target categories readable without exposing raw type keys", () => {
    expect(getAuditTargetTypeLabel("education_verification")).toBe("教育认证");
    expect(getAuditTargetTypeLabel("major_final_result")).toBe("Major 最终赛果");
    expect(getAuditTargetTypeLabel("future_target")).toBe("其他对象");
  });
});
