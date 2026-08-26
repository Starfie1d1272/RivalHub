import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMajorDefaultCapabilities } from "@/types/season";

const { seasonFindFirstMock, teamsFindManyMock, stateFindFirstMock, finalResultsFindFirstMock, selectMock } = vi.hoisted(() => ({
  seasonFindFirstMock: vi.fn(),
  teamsFindManyMock: vi.fn(),
  stateFindFirstMock: vi.fn(),
  finalResultsFindFirstMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      seasons: { findFirst: seasonFindFirstMock },
      teams: { findMany: teamsFindManyMock },
      majorPrestartStates: { findFirst: stateFindFirstMock },
      majorFinalResults: { findFirst: finalResultsFindFirstMock },
    },
    select: selectMock,
  },
}));

vi.mock("next/navigation", () => ({ notFound: vi.fn() }));

import AdminMajorConsolePage from "@/app/admin/[seasonSlug]/page";

describe("admin Major prestart console page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    const capabilities = createMajorDefaultCapabilities();
    seasonFindFirstMock.mockResolvedValue({
      id: "season-1",
      name: "RivalHub Major 2027",
      ...capabilities,
    });
    teamsFindManyMock.mockResolvedValue([]);
    stateFindFirstMock.mockResolvedValue(undefined);
    finalResultsFindFirstMock.mockResolvedValue(undefined);
    selectMock.mockImplementation(() => chain([]));
  });

  it("reads only persisted prestart facts and leaves seeds explicitly unavailable", async () => {
    const page = await AdminMajorConsolePage({ params: Promise.resolve({ seasonSlug: "major-2027" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("赛事控制台 · RivalHub Major 2027");
    expect(html).toContain("准备未完成");
    expect(html).toContain("当前有 0 支队伍，Major 开赛需要恰好 32 支队伍。");
    expect(html).toContain("尚未接入/不可确认");
    expect(html).toContain("正式参赛队 (0/32)");
    expect(html).toContain("正式开赛确认");
    expect(html).toContain("所有已审核 teams 不会自动成为 Major 参赛队");
    expect(html).toContain("当前不会推导或展示临时对阵");
  });
});

function chain<T>(value: T) {
  const result = {
    from: () => result,
    innerJoin: () => result,
    where: () => result,
    orderBy: () => result,
    then: (resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(value).then(resolve, reject),
  };
  return result;
}
