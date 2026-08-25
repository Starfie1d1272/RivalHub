import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMajorDefaultCapabilities } from "@/types/season";

const { seasonFindFirstMock, teamsFindManyMock } = vi.hoisted(() => ({
  seasonFindFirstMock: vi.fn(),
  teamsFindManyMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    query: {
      seasons: { findFirst: seasonFindFirstMock },
      teams: { findMany: teamsFindManyMock },
    },
    select: vi.fn(),
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
  });

  it("renders the domain result and keeps unconnected facts explicitly unavailable", async () => {
    const page = await AdminMajorConsolePage({ params: Promise.resolve({ seasonSlug: "major-2027" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("赛事控制台 · RivalHub Major 2027");
    expect(html).toContain("准备未完成");
    expect(html).toContain("当前有 0 支队伍，Major 开赛需要恰好 32 支队伍。");
    expect(html).toContain("尚未接入/不可确认");
    expect(html).toContain("当前不会推导或展示临时对阵");
  });
});
