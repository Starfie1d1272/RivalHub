import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ db: {} }));

import { groupMyCompetitionContexts, projectMyCompetitionContext, selectCanonicalMyCompetitionSources, type MyCompetitionSource, type MyCompetitionSourceCandidate } from "@/lib/my/competitions";
import { MAJOR_TEAM_CONFIG } from "@/lib/competition/templates";

const USER_ID = "user-1";

function source(overrides: Partial<MyCompetitionSource> = {}): MyCompetitionSource {
  return {
    id: "entry-1",
    name: "Rival Five",
    teamId: "team-1",
    seasonId: "season-1",
    seasonName: "2026 秋季赛",
    seasonSlug: "fall-2026",
    seasonStatus: "registration",
    seasonCreatedAt: new Date("2026-08-01T00:00:00Z"),
    entryUpdatedAt: new Date("2026-08-02T00:00:00Z"),
    registrationStatus: "approved",
    participantStatus: "confirmed",
    representativeUserId: "captain-1",
    teamRegistrationConfig: { ...MAJOR_TEAM_CONFIG },
    ...overrides,
  };
}

function candidate(overrides: Partial<MyCompetitionSourceCandidate> = {}): MyCompetitionSourceCandidate {
  const { activeClaimEntryId = null, ...sourceOverrides } = overrides;
  return { ...source(sourceOverrides), activeClaimEntryId };
}

describe("个人赛事上下文投影", () => {
  it.each([
    ["draft", "representative", "继续报名"],
    ["changes_requested", "representative", "处理补正"],
  ] as const)("为负责人 %s 生成 %s CTA", (registrationStatus, _role, label) => {
    const result = projectMyCompetitionContext(source({ registrationStatus, participantStatus: null, representativeUserId: USER_ID }), USER_ID);
    expect(result.viewerRole).toBe("representative");
    expect(result.primaryAction).toMatchObject({ href: "/fall-2026/register", label });
  });

  it("为被邀请的参赛成员保留确认动作", () => {
    const result = projectMyCompetitionContext(source({ participantStatus: "invited", registrationStatus: "changes_requested" }), USER_ID);
    expect(result.viewerRole).toBe("participant");
    expect(result.participation).toMatchObject({ label: "需要重新确认" });
    expect(result.primaryAction).toMatchObject({ label: "确认是否参赛" });
  });

  it("让只有长期队伍关联的成员进入赛事而不伪造已参赛状态", () => {
    const result = projectMyCompetitionContext(source({ participantStatus: null }), USER_ID);
    expect(result.viewerRole).toBe("team_member");
    expect(result.participation).toBeNull();
    expect(result.primaryAction).toEqual({ href: "/fall-2026", label: "查看赛事" });
  });

  it("按报名页优先级每个赛季只保留一个个人赛事 Entry", () => {
    const oldEntry = candidate({ id: "entry-old", entryUpdatedAt: new Date("2026-08-01T00:00:00Z"), participantStatus: "confirmed" });
    const pendingInvitation = candidate({ id: "entry-pending", entryUpdatedAt: new Date("2026-08-03T00:00:00Z"), participantStatus: "invited" });
    const activeClaim = candidate({ id: "entry-active", entryUpdatedAt: new Date("2026-08-02T00:00:00Z"), participantStatus: "confirmed", activeClaimEntryId: "entry-active" });

    expect(selectCanonicalMyCompetitionSources([oldEntry, pendingInvitation, activeClaim], USER_ID).map((entry) => entry.id)).toEqual(["entry-active"]);
    expect(selectCanonicalMyCompetitionSources([oldEntry, pendingInvitation], USER_ID).map((entry) => entry.id)).toEqual(["entry-pending"]);
    expect(selectCanonicalMyCompetitionSources([oldEntry, candidate({ id: "entry-latest", entryUpdatedAt: new Date("2026-08-04T00:00:00Z"), participantStatus: "confirmed" })], USER_ID).map((entry) => entry.id)).toEqual(["entry-latest"]);
    expect(selectCanonicalMyCompetitionSources([candidate({ id: "entry-representative", participantStatus: null, representativeUserId: USER_ID })], USER_ID).map((entry) => entry.id)).toEqual(["entry-representative"]);
  });

  it("不会把个人比赛事实挂到只有长期队伍关联的成员上", () => {
    const result = projectMyCompetitionContext(source({ participantStatus: null, seasonStatus: "playing" }), USER_ID, {
      matchId: "match-1",
      seasonId: "season-1",
      seasonSlug: "fall-2026",
      opponentName: "对手队",
      scheduledAt: new Date("2026-09-01T10:00:00Z"),
      status: "scheduled",
    });
    expect(result.nextMatch).toBeUndefined();
    expect(result.primaryAction).toEqual({ href: "/fall-2026", label: "查看赛事" });
  });

  it("只把按 Entry 绑定的下一场比赛投影给对应个人赛事", () => {
    const canonical = projectMyCompetitionContext(source({ id: "entry-canonical", seasonStatus: "playing" }), USER_ID, {
      matchId: "match-canonical",
      seasonId: "season-1",
      seasonSlug: "fall-2026",
      opponentName: "当前对手",
      scheduledAt: new Date("2026-09-01T10:00:00Z"),
      status: "scheduled",
    });
    const oldEntry = projectMyCompetitionContext(source({ id: "entry-old", seasonStatus: "playing" }), USER_ID);

    expect(canonical.nextMatch?.href).toBe("/fall-2026/matches/match-canonical");
    expect(oldEntry.nextMatch).toBeUndefined();
  });

  it("把比赛期的真实下一场和已结束赛事分别映射到主动作", () => {
    const playing = projectMyCompetitionContext(source({ seasonStatus: "playing" }), USER_ID, { matchId: "match-1", seasonId: "season-1", seasonSlug: "fall-2026", opponentName: "对手队", scheduledAt: new Date("2026-09-01T10:00:00Z"), status: "in_progress" });
    expect(playing.primaryAction).toEqual({ href: "/fall-2026/matches/match-1", label: "你的当前比赛" });
    expect(playing.nextMatch?.detail).toContain("对阵 对手队");

    const finished = projectMyCompetitionContext(source({ seasonStatus: "finished" }), USER_ID);
    expect(finished.primaryAction).toEqual({ href: "/fall-2026", label: "赛事回顾" });
  });

  it("比赛期没有当前比赛时回到赛事上下文", () => {
    const result = projectMyCompetitionContext(source({ seasonStatus: "playing" }), USER_ID);
    expect(result.primaryAction).toEqual({ href: "/fall-2026", label: "查看赛事" });
  });

  it("按赛季状态分组并在组内确定性倒序", () => {
    const newer = projectMyCompetitionContext(source({ id: "entry-new", seasonId: "season-new", seasonName: "更新赛", seasonCreatedAt: new Date("2026-09-01T00:00:00Z") }), USER_ID);
    const older = projectMyCompetitionContext(source({ id: "entry-old", seasonId: "season-old", seasonName: "旧赛", seasonCreatedAt: new Date("2026-08-01T00:00:00Z") }), USER_ID);
    const history = projectMyCompetitionContext(source({ id: "entry-history", seasonId: "season-history", seasonName: "历史赛", seasonStatus: "archived", seasonCreatedAt: new Date("2025-08-01T00:00:00Z") }), USER_ID);
    const result = groupMyCompetitionContexts([older, history, newer]);
    expect(result.current.map((entry) => entry.entryId)).toEqual(["entry-new", "entry-old"]);
    expect(result.history.map((entry) => entry.entryId)).toEqual(["entry-history"]);
  });
});
