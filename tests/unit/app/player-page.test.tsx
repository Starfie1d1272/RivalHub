import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectionMock = vi.hoisted(() => vi.fn());
const getPublicPlayerByIdMock = vi.hoisted(() => vi.fn());
const {
  userFindFirstMock,
  selectMock,
  selectDistinctMock,
  loadCompetitivePlatformCatalogMock,
  getSeasonHexagonScoresMock,
  getPublicPlayerLftMock,
} = vi.hoisted(() => ({
  userFindFirstMock: vi.fn(),
  selectMock: vi.fn(),
  selectDistinctMock: vi.fn(),
  loadCompetitivePlatformCatalogMock: vi.fn(),
  getSeasonHexagonScoresMock: vi.fn(),
  getPublicPlayerLftMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    query: { users: { findFirst: userFindFirstMock } },
    select: selectMock,
    selectDistinct: selectDistinctMock,
  },
}));

vi.mock("@/lib/competitive/catalog", () => ({ loadCompetitivePlatformCatalog: loadCompetitivePlatformCatalogMock }));
vi.mock("@/actions/hexagon", () => ({ getSeasonHexagonScores: getSeasonHexagonScoresMock }));
vi.mock("@/lib/recruitment/data", () => ({ getPublicPlayerLft: getPublicPlayerLftMock }));
vi.mock("next/server", () => ({ connection: connectionMock }));
vi.mock("@/lib/data/public-players", () => ({ getPublicPlayerById: getPublicPlayerByIdMock }));

import { PlayerPageContent } from "@/app/players/[userId]/page";

function chain<T>(value: T) {
  const result = {
    from: () => result,
    innerJoin: () => result,
    where: () => result,
    orderBy: () => result,
    groupBy: () => result,
    then: (resolve: (resolved: T) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject),
  };
  return result;
}

describe("player page education wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    connectionMock.mockResolvedValue(undefined);
    getPublicPlayerByIdMock.mockResolvedValue({
      id: "user-1",
      displayName: "玩家甲",
      perfectName: null,
      steamName: null,
      steam64: null,
      steamProfileUrl: null,
      avatarUrl: null,
    });
    loadCompetitivePlatformCatalogMock.mockResolvedValue([]);
    getSeasonHexagonScoresMock.mockResolvedValue(new Map());
    getPublicPlayerLftMock.mockResolvedValue(null);
    selectDistinctMock.mockImplementation(() => chain([]));
    selectMock.mockImplementation((selection?: Record<string, unknown>) => {
      if (selection && "institutionName" in selection) {
        return chain([{
          id: "claim-1",
          institutionId: "institution-nju",
          institutionName: "南京大学",
          academicStatus: "enrolled",
          status: "approved",
          submittedAt: new Date("2026-08-01T00:00:00Z"),
        }]);
      }
      return chain([]);
    });
  });

  it("renders approved education identity and keeps the page query explicit", async () => {
    const page = await PlayerPageContent({ params: Promise.resolve({ userId: "user-1" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("高校身份");
    expect(html).toContain("南京大学 · 在读 · 已认证");

    const educationSelection = selectMock.mock.calls
      .map(([selection]) => selection as Record<string, unknown> | undefined)
      .find((selection) => selection && "institutionName" in selection);
    expect(educationSelection).toBeDefined();
    expect(educationSelection).not.toHaveProperty("evidenceCode");
    expect(educationSelection).not.toHaveProperty("evidenceType");
    expect(educationSelection).not.toHaveProperty("reviewNote");
    expect(educationSelection).not.toHaveProperty("reviewedBy");
  });
});
