import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/lib/errors";

const {
  requireAuthMock,
  auditActorIdMock,
  userFindFirstMock,
  transactionMock,
  inviteTeamMemberInTxMock,
  removeInterestAfterInvitationInTxMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  auditActorIdMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  transactionMock: vi.fn(),
  inviteTeamMemberInTxMock: vi.fn(),
  removeInterestAfterInvitationInTxMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

const TX = {};

vi.mock("@/lib/auth/session", () => ({
  requireAuth: requireAuthMock,
  auditActorId: auditActorIdMock,
  requireSuperAdmin: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      users: { findFirst: userFindFirstMock },
      teams: { findFirst: vi.fn() },
    },
    transaction: transactionMock,
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/auth/supabase-server", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/teams/invitations", () => ({ acceptTeamInvitationInTx: vi.fn() }));
vi.mock("@/lib/recruitment/commands", () => ({ removeInterestAfterInvitationInTx: removeInterestAfterInvitationInTxMock }));
vi.mock("@/lib/teams/commands", () => ({
  createTeamInTx: vi.fn(),
  createTeamShareInvitationInTx: vi.fn(),
  declineTeamInvitationInTx: vi.fn(),
  disbandTeamInTx: vi.fn(),
  inviteTeamMemberInTx: inviteTeamMemberInTxMock,
  kickTeamMemberInTx: vi.fn(),
  leaveTeamInTx: vi.fn(),
  revokeTeamInvitationInTx: vi.fn(),
  setTeamMembershipStatusInTx: vi.fn(),
  transferTeamCaptainInTx: vi.fn(),
  updateTeamLogoInTx: vi.fn(),
  updateTeamProfileInTx: vi.fn(),
  hashTeamInvitationToken: vi.fn(() => "hash"),
}));

import { inviteTeamMember, inviteTeamMemberByUserId } from "@/actions/teams";

const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const CAPTAIN_ID = "22222222-2222-4222-8222-222222222222";
const INVITEE_ID = "33333333-3333-4333-8333-333333333333";
const INVITEE_EMAIL = "invitee@example.com";
const PENDING_INVITATION_CONSTRAINT = "team_invitations_one_pending_direct_per_user";

function wrappedUniqueError(constraint: string): unknown {
  return {
    query: "insert into team_invitations ...",
    params: ["sensitive-value"],
    cause: {
      code: "23505",
      constraint,
      detail: "Key (invited_user_id)=(sensitive-value) already exists.",
    },
  };
}

describe("Team invitation unique-constraint mapping", () => {
  let consoleErrorMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ userId: CAPTAIN_ID, email: "captain@example.com" });
    auditActorIdMock.mockReturnValue(CAPTAIN_ID);
    userFindFirstMock.mockResolvedValue({ id: INVITEE_ID, email: INVITEE_EMAIL });
    transactionMock.mockImplementation((callback: (tx: unknown) => unknown) => callback(TX));
    removeInterestAfterInvitationInTxMock.mockResolvedValue(undefined);
    consoleErrorMock = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorMock.mockRestore();
  });

  it("maps the wrapped pending-invitation constraint for email invitations", async () => {
    inviteTeamMemberInTxMock.mockRejectedValue(wrappedUniqueError(PENDING_INVITATION_CONSTRAINT));

    const result = await inviteTeamMember({ teamId: TEAM_ID, email: INVITEE_EMAIL });

    expect(result).toEqual({ success: false, error: { code: ErrorCode.VALIDATION_FAILED, message: "该邀请已存在。" } });
    expect(consoleErrorMock).not.toHaveBeenCalled();
  });

  it("does not map an unrelated wrapped unique constraint for email invitations", async () => {
    inviteTeamMemberInTxMock.mockRejectedValue(wrappedUniqueError("teams_slug_unique"));

    const result = await inviteTeamMember({ teamId: TEAM_ID, email: INVITEE_EMAIL });

    expect(result).toEqual({ success: false, error: { code: ErrorCode.INTERNAL_ERROR, message: "服务器内部错误，请稍后重试" } });
    expect(consoleErrorMock).toHaveBeenCalledOnce();
  });

  it("uses the same exact mapping for the player-page handoff", async () => {
    inviteTeamMemberInTxMock.mockRejectedValue(wrappedUniqueError(PENDING_INVITATION_CONSTRAINT));

    const result = await inviteTeamMemberByUserId({ teamId: TEAM_ID, userId: INVITEE_ID });

    expect(result).toEqual({ success: false, error: { code: ErrorCode.VALIDATION_FAILED, message: "该邀请已存在。" } });
    expect(removeInterestAfterInvitationInTxMock).not.toHaveBeenCalled();
  });

  it("does not map an unrelated wrapped unique constraint for the handoff", async () => {
    inviteTeamMemberInTxMock.mockRejectedValue(wrappedUniqueError("teams_slug_unique"));

    const result = await inviteTeamMemberByUserId({ teamId: TEAM_ID, userId: INVITEE_ID });

    expect(result).toEqual({ success: false, error: { code: ErrorCode.INTERNAL_ERROR, message: "服务器内部错误，请稍后重试" } });
  });
});
