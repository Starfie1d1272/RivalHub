import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockUserSession } from "tests/helpers";
import type { DisciplinaryCase } from "@/db/schema";

const { seasonFindFirstMock, selectMock, requireSeasonAdminMock, getSeasonSanctionsMock, notFoundMock, redirectMock } = vi.hoisted(() => ({
  seasonFindFirstMock: vi.fn(),
  selectMock: vi.fn(),
  requireSeasonAdminMock: vi.fn(),
  getSeasonSanctionsMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirectMock: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      seasons: { findFirst: seasonFindFirstMock },
    },
    select: selectMock,
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireSeasonAdmin: requireSeasonAdminMock,
}));

vi.mock("@/actions/discipline", () => ({
  getSeasonSanctions: getSeasonSanctionsMock,
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
  useRouter: () => ({ refresh: vi.fn() }),
}));

import AdminDisciplinePage from "@/app/admin/[seasonSlug]/discipline/page";

function makeCase(overrides: Partial<DisciplinaryCase> = {}): DisciplinaryCase & { resolvedStatus: string } {
  const base: DisciplinaryCase = {
    id: "case-1",
    seasonId: "season-1",
    subjectUserId: "user-1",
    status: "active",
    effects: [],
    internalEvidence: null,
    publicExplanation: null,
    effectiveFrom: new Date("2026-08-01T00:00:00Z"),
    effectiveUntil: null,
    issuedBy: "admin-1",
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
  };
  return { ...base, ...overrides, resolvedStatus: "active" };
}

function chain<T>(value: T) {
  const result = {
    from: () => result,
    innerJoin: () => result,
    where: () => result,
    orderBy: () => result,
    then: (resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject),
  };
  return result;
}

describe("admin discipline page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    seasonFindFirstMock.mockResolvedValue({ id: "season-1", name: "RivalHub Major 2027" });
    requireSeasonAdminMock.mockResolvedValue(mockUserSession({ role: "super_admin" }));
    selectMock.mockImplementation(() => chain([{ id: "user-1", displayName: "玩家甲", steamName: null, email: "a@example.test" }]));
    getSeasonSanctionsMock.mockResolvedValue({
      success: true as const,
      data: [
        makeCase({
          id: "case-1",
          seasonId: "season-1",
          subjectUserId: "user-1",
          status: "active",
          effects: ["registration_block", "roster_block"],
          internalEvidence: "私密证据：聊天记录截图链接 https://internal.example/secret",
          publicExplanation: "违反赛场行为规范",
        }),
      ],
    });
  });

  it("renders season sanctions with resolved status and admin-only internal evidence", async () => {
    const page = await AdminDisciplinePage({ params: Promise.resolve({ seasonSlug: "major-2027" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("纪律处罚管理 · RivalHub Major 2027");
    expect(html).toContain("玩家甲");
    expect(html).toContain("私密证据：聊天记录截图链接");
    expect(html).toContain("违反赛场行为规范");
    expect(html).toContain("生效中");
    expect(html).toContain("参赛拦截");
  });

  it("renders an explicit error state when loading sanctions fails", async () => {
    getSeasonSanctionsMock.mockResolvedValue({
      success: false as const,
      error: { code: "FORBIDDEN", message: "没有权限执行该操作。" },
    });
    const page = await AdminDisciplinePage({ params: Promise.resolve({ seasonSlug: "major-2027" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("无法加载纪律处罚记录");
    expect(html).toContain("FORBIDDEN");
    expect(html).toContain("没有权限执行该操作。");
  });

  it("rejects users without season admin permission", async () => {
    requireSeasonAdminMock.mockRejectedValue(new Error("forbidden"));
    await expect(AdminDisciplinePage({ params: Promise.resolve({ seasonSlug: "major-2027" }) })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("404s for unknown season slug", async () => {
    seasonFindFirstMock.mockResolvedValue(undefined);
    await expect(AdminDisciplinePage({ params: Promise.resolve({ seasonSlug: "nope" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });
});
