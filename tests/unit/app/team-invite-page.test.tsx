/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { presentTeamShareInvitation } from "@/lib/teams/presentation";

const { selectMock, getUserSessionMock, notFoundMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  getUserSessionMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/db/client", () => ({ db: { select: selectMock } }));
vi.mock("@/lib/auth/session", () => ({ getUserSession: getUserSessionMock }));
vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("@/components/register/ClaimTeamInviteButton", () => ({
  ClaimTeamInviteButton: () => React.createElement("button", { type: "button" }, "加入队伍"),
}));

import TeamInvitePage from "@/app/team-invites/[token]/page";

const TOKEN = "a".repeat(43);
const FUTURE = new Date("2030-01-08T00:00:00.000Z");
const NOW = new Date("2030-01-01T00:00:00.000Z");

type InvitationRow = {
  teamName: string;
  teamStatus: "active" | "disbanded";
  status: "pending" | "accepted" | "declined" | "revoked" | "expired";
  expiresAt: Date;
};

function chain<T>(value: T) {
  const result = {
    from: () => result,
    innerJoin: () => result,
    where: () => result,
    limit: async () => value,
  };
  return result;
}

function mockInvitation(row: InvitationRow | undefined): void {
  selectMock.mockImplementation(() => chain(row ? [row] : []));
}

async function renderPage(row: InvitationRow, session: unknown = null): Promise<string> {
  mockInvitation(row);
  getUserSessionMock.mockResolvedValue(session);
  return renderToStaticMarkup(await TeamInvitePage({ params: Promise.resolve({ token: TOKEN }) }));
}

describe("Team share invitation page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    getUserSessionMock.mockResolvedValue(null);
  });

  it("keeps invalid and unknown tokens fail-closed", async () => {
    await expect(TeamInvitePage({ params: Promise.resolve({ token: "short" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(selectMock).not.toHaveBeenCalled();

    mockInvitation(undefined);
    await expect(TeamInvitePage({ params: Promise.resolve({ token: TOKEN }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(2);
    expect(getUserSessionMock).not.toHaveBeenCalled();
  });

  it("reads only share-link state and preserves the valid unauthenticated flow", async () => {
    const html = await renderPage({ teamName: "Rival Team", teamStatus: "active", status: "pending", expiresAt: FUTURE });

    expect(html).toContain("加入 Rival Team");
    expect(html).toContain("这是队伍邀请");
    expect(html).toContain("登录后加入");
    expect(html).toContain("注册后加入");
    expect(html).toContain(`href=\"/login?next=%2Fteam-invites%2F${TOKEN}\"`);
    expect(html).toContain(`href=\"/login?mode=register&amp;next=%2Fteam-invites%2F${TOKEN}\"`);

    const selection = selectMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(selection).sort()).toEqual(["expiresAt", "status", "teamName", "teamStatus"]);
    expect(selection).not.toHaveProperty("respondedByUserId");
  });

  it("renders the valid authenticated flow with the accept button", async () => {
    const html = await renderPage(
      { teamName: "Rival Team", teamStatus: "active", status: "pending", expiresAt: FUTURE },
      { userId: "user-1" },
    );

    expect(html).toContain("加入 Rival Team");
    expect(html).toContain("<button type=\"button\">加入队伍</button>");
    expect(html).not.toContain("登录后加入");
    expect(html).not.toContain("注册后加入");
  });

  it.each([
    ["accepted", { status: "accepted" as const, expiresAt: FUTURE }, "邀请已被使用", "这个邀请链接已经被使用，无法再次加入队伍。"],
    ["revoked", { status: "revoked" as const, expiresAt: FUTURE }, "邀请已撤销", "这个邀请已被队长撤销。"],
    ["pending at the expiry boundary", { status: "pending" as const, expiresAt: new Date(Date.now() - 1) }, "邀请链接已过期", "这个邀请链接已过期。"],
    ["expired", { status: "expired" as const, expiresAt: FUTURE }, "邀请链接已过期", "这个邀请链接已过期。"],
    ["disbanded team", { status: "pending" as const, expiresAt: FUTURE, teamStatus: "disbanded" as const }, "队伍已解散", "这支队伍已解散，这个邀请已失效。"],
    ["unexpected declined state", { status: "declined" as const, expiresAt: FUTURE }, "邀请已失效", "这个邀请链接当前不可用。"],
  ] as const)("renders %s as a non-actionable business state", async (_name, overrides, title, sub) => {
    const row: InvitationRow = { teamName: "Rival Team", teamStatus: "active", status: "pending", expiresAt: FUTURE };
    Object.assign(row, overrides);
    const html = await renderPage(row);

    expect(html).toContain(`<h1 class=\"mt-2 text-2xl font-semibold\">${title}</h1>`);
    expect(html).toContain(title);
    expect(html).toContain(sub);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("href=\"/login");
    expect(getUserSessionMock).not.toHaveBeenCalled();
  });

  it("locks deterministic priority before rendering the page", () => {
    expect(presentTeamShareInvitation({ teamStatus: "disbanded", status: "accepted", expiresAt: NOW }, NOW)).toMatchObject({ state: "disbanded", canAccept: false });
    expect(presentTeamShareInvitation({ teamStatus: "active", status: "accepted", expiresAt: NOW }, NOW)).toMatchObject({ state: "accepted", canAccept: false });
    expect(presentTeamShareInvitation({ teamStatus: "active", status: "revoked", expiresAt: NOW }, NOW)).toMatchObject({ state: "revoked", canAccept: false });
    expect(presentTeamShareInvitation({ teamStatus: "active", status: "pending", expiresAt: NOW }, NOW)).toMatchObject({ state: "expired", canAccept: false });
  });
});
