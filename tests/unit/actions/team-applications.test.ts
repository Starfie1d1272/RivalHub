import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

const SEASON_ID = "11111111-1111-1111-1111-111111111111";
const APPLICATION_ID = "22222222-2222-2222-2222-222222222222";
const MEMBER_ID = "33333333-3333-3333-3333-333333333333";
const CAPTAIN_ID = "44444444-4444-4444-4444-444444444444";
const PLAYER_ID = "55555555-5555-5555-5555-555555555555";

const {
  seasonFindFirstMock,
  applicationFindFirstMock,
  memberFindFirstMock,
  teamMemberFindFirstMock,
  teamFindFirstMock,
  userFindFirstMock,
  selectMock,
  txInsertMock,
  txUpdateMock,
  txDeleteMock,
  transactionMock,
  requireAuthMock,
  revalidatePathMock,
  getRegistrationWindowStateMock,
  insertValuesCalls,
} = vi.hoisted(() => {
  const insertValuesCalls: unknown[] = [];
  return {
    seasonFindFirstMock: vi.fn(),
    applicationFindFirstMock: vi.fn(),
    memberFindFirstMock: vi.fn(),
    teamMemberFindFirstMock: vi.fn(),
    teamFindFirstMock: vi.fn(),
    userFindFirstMock: vi.fn(),
    selectMock: vi.fn(),
    txInsertMock: vi.fn(),
    txUpdateMock: vi.fn(),
    txDeleteMock: vi.fn(),
    transactionMock: vi.fn(),
    requireAuthMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    getRegistrationWindowStateMock: vi.fn(),
    insertValuesCalls,
  };
});

vi.mock("@/lib/auth/session", () => ({
  requireAuth: requireAuthMock,
  auditActorId: vi.fn((session: { userId: string }) => session.userId),
}));

vi.mock("@/lib/registration/window", () => ({
  getRegistrationWindowState: getRegistrationWindowStateMock,
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

vi.mock("@/db/client", () => {
  return {
    db: {
      query: {
        seasons: { findFirst: seasonFindFirstMock },
        teamApplications: { findFirst: applicationFindFirstMock },
        teamApplicationMembers: { findFirst: memberFindFirstMock },
        teamMembers: { findFirst: teamMemberFindFirstMock },
        teams: { findFirst: teamFindFirstMock },
        users: { findFirst: userFindFirstMock },
      },
      select: selectMock,
      transaction: transactionMock,
    },
  };
});

import {
  confirmTeamApplicationMembership,
  createTeamApplication,
  inviteTeamApplicationMember,
  removeTeamApplicationMember,
  submitTeamApplication,
  updateTeamApplication,
} from "@/actions/team-applications";

const SEASON = {
  id: SEASON_ID,
  slug: "team-cup",
  status: "registration",
  minTeamSize: 2,
  maxTeamSize: 5,
  registrationMode: "team",
  teamRegistrationConfig: { allowExternal: true, minHomeMembers: 0, maxExternalMembers: 5 },
  registrationConfig: null,
  capabilities: { teamRegistration: true },
};

const APPLICATION = {
  id: APPLICATION_ID,
  seasonId: SEASON_ID,
  captainUserId: CAPTAIN_ID,
  status: "draft",
  name: "Rival Team",
  logoUrl: null,
};

function setupTransaction() {
  transactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    query: { teamMembers: { findFirst: teamMemberFindFirstMock }, teamApplicationActiveClaims: { findFirst: vi.fn().mockResolvedValue(null) } },
    insert: txInsertMock,
    update: txUpdateMock,
    delete: txDeleteMock,
  }));
  txUpdateMock.mockImplementation(() => ({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  }));
  txDeleteMock.mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
}

function setupInsert() {
  txInsertMock.mockImplementation(() => ({
    values: vi.fn((values: unknown) => {
      insertValuesCalls.push(values);
      return {
        onConflictDoNothing: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ applicationId: APPLICATION_ID }]) }),
        returning: vi.fn().mockResolvedValue([{ id: APPLICATION_ID }]),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(undefined)),
      };
    }),
  }));
}

function mockActiveApplicationCheck(rows: unknown[] = []) {
  selectMock.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }) }),
    }),
  });
}

function mockMembers(rows: unknown[]) {
  selectMock.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({ leftJoin: vi.fn().mockReturnValue({ leftJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(rows) }) }) }),
    }),
  });
}

/** Queued after mockMembers for submit-path tests: no active sanctions. */
function mockDisciplinaryCases(rows: unknown[] = []) {
  selectMock.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  insertValuesCalls.length = 0;
  requireAuthMock.mockResolvedValue({ userId: CAPTAIN_ID, email: "captain@rivalhub.test" });
  getRegistrationWindowStateMock.mockReturnValue({ canSubmit: true, message: "报名开放中" });
  seasonFindFirstMock.mockResolvedValue(SEASON);
  applicationFindFirstMock.mockResolvedValue(APPLICATION);
  memberFindFirstMock.mockResolvedValue(null);
  teamMemberFindFirstMock.mockResolvedValue(null);
  teamFindFirstMock.mockResolvedValue(null);
  userFindFirstMock.mockResolvedValue({ id: PLAYER_ID, email: "player@rivalhub.test" });
  setupTransaction();
  setupInsert();
});

describe("team application participant actions", () => {
  it("creates a draft application with the captain already confirmed", async () => {
    mockActiveApplicationCheck();
    const result = await createTeamApplication({ seasonId: SEASON_ID, name: "Rival Team" });

    expect(result).toEqual({ success: true, data: { applicationId: APPLICATION_ID } });
    expect(insertValuesCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ seasonId: SEASON_ID, captainUserId: CAPTAIN_ID, name: "Rival Team" }),
      expect.objectContaining({ applicationId: APPLICATION_ID, userId: CAPTAIN_ID, status: "confirmed" }),
      expect.objectContaining({ action: "team_application.create" }),
    ]));
    expect(revalidatePathMock).toHaveBeenCalledWith("/team-cup/register");
  });

  it("rejects malformed application creation before authenticating", async () => {
    const result = await createTeamApplication({ seasonId: "not-a-uuid", name: "x" });

    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
    expect(requireAuthMock).not.toHaveBeenCalled();
  });

  it("edits a draft application and records the previous name", async () => {
    const result = await updateTeamApplication({ applicationId: APPLICATION_ID, name: "Renamed Team", logoUrl: "https://example.test/logo.png" });

    expect(result).toEqual({ success: true, data: undefined });
    expect(insertValuesCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "team_application.update", meta: { fromName: "Rival Team", toName: "Renamed Team" } }),
    ]));
  });

  it("invites a registered player only after active-application and formal-team checks", async () => {
    mockActiveApplicationCheck();
    const result = await inviteTeamApplicationMember({ applicationId: APPLICATION_ID, email: "player@rivalhub.test" });

    expect(result).toEqual({ success: true, data: undefined });
    expect(userFindFirstMock).toHaveBeenCalled();
    expect(insertValuesCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ applicationId: APPLICATION_ID, userId: PLAYER_ID, invitedByUserId: CAPTAIN_ID }),
      expect.objectContaining({ action: "team_application.invite_member" }),
    ]));
  });

  it("does not allow the captain to remove themself", async () => {
    memberFindFirstMock.mockResolvedValue({ id: MEMBER_ID, applicationId: APPLICATION_ID, userId: CAPTAIN_ID });
    const result = await removeTeamApplicationMember({ applicationId: APPLICATION_ID, memberId: MEMBER_ID });

    expect(result).toMatchObject({ success: false, error: { code: ErrorCode.VALIDATION_FAILED } });
    expect(txDeleteMock).not.toHaveBeenCalled();
  });

  it("removes an invited teammate and audits the removal", async () => {
    memberFindFirstMock.mockResolvedValue({ id: MEMBER_ID, applicationId: APPLICATION_ID, userId: PLAYER_ID });
    const result = await removeTeamApplicationMember({ applicationId: APPLICATION_ID, memberId: MEMBER_ID });

    expect(result).toEqual({ success: true, data: undefined });
    expect(txDeleteMock).toHaveBeenCalled();
    expect(insertValuesCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "team_application.remove_member", meta: { removedUserId: PLAYER_ID } }),
    ]));
  });

  it("confirms an invite as the invited player and persists a confirmation audit", async () => {
    requireAuthMock.mockResolvedValue({ userId: PLAYER_ID, email: "player@rivalhub.test" });
    memberFindFirstMock.mockResolvedValue({ id: MEMBER_ID, applicationId: APPLICATION_ID, userId: PLAYER_ID, status: "invited" });
    const result = await confirmTeamApplicationMembership({ applicationId: APPLICATION_ID });

    expect(result).toEqual({ success: true, data: undefined });
    expect(txUpdateMock).toHaveBeenCalled();
    expect(insertValuesCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "team_application.confirm_member", meta: { memberId: MEMBER_ID } }),
    ]));
  });

  it("submits only a confirmed roster and keeps it out of formal teams", async () => {
    mockMembers([
      { id: MEMBER_ID, userId: CAPTAIN_ID, status: "confirmed", email: "captain@rivalhub.test", emailVerifiedAt: new Date(), verificationId: null, verificationStatus: null, verificationAcademicStatus: null, institutionCode: null, institutionName: null },
      { id: "66666666-6666-6666-6666-666666666666", userId: PLAYER_ID, status: "confirmed", email: "player@rivalhub.test", emailVerifiedAt: new Date(), verificationId: null, verificationStatus: null, verificationAcademicStatus: null, institutionCode: null, institutionName: null },
    ]);
    mockDisciplinaryCases([]);
    const result = await submitTeamApplication({ applicationId: APPLICATION_ID });

    expect(result).toEqual({ success: true, data: undefined });
    expect(teamFindFirstMock).toHaveBeenCalled();
    expect(insertValuesCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "team_application.submit", meta: { confirmedMemberCount: 2 } }),
    ]));
    expect(txInsertMock).not.toHaveBeenCalledWith(expect.objectContaining({ teamApplicationId: APPLICATION_ID }));
  });
});
