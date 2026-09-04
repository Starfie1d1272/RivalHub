import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({ db: { select: selectMock } }));
vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

import { getPublicPlayerById } from "@/lib/data/public-players";

function query(value: unknown) {
  const result = {
    from: vi.fn(() => result),
    where: vi.fn(() => result),
    limit: vi.fn(() => result),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject),
  };
  return result;
}

const baseUserRow = {
  id: "user-1",
  displayName: "Player 1",
  perfectName: "Perfect 1",
  steamName: "Steam 1",
  steamProfileUrl: "https://steamcommunity.com/id/player1",
  avatarUrl: null,
};

describe("getPublicPlayerById read-model safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when player does not exist", async () => {
    selectMock.mockImplementationOnce(() => query([]));
    const result = await getPublicPlayerById("nonexistent");
    expect(result).toBeNull();
  });

  it("normalizes and returns canonical steamProfileUrl for valid URL", async () => {
    selectMock.mockImplementationOnce(() =>
      query([
        {
          ...baseUserRow,
          steamProfileUrl: "  https://steamcommunity.com/id/player1/?ref=steam#profile  ",
        },
      ]),
    );

    const result = await getPublicPlayerById("user-1");
    expect(result).toEqual({
      ...baseUserRow,
      steamProfileUrl: "https://steamcommunity.com/id/player1",
    });
  });

  it("defensively outputs null for invalid legacy values", async () => {
    const invalidLegacyValues = [
      "https://steamcommunity.com/profiles/76561198000000001/edit",
      "https://steamcommunity.com.attacker.example/id/player1",
      "https://attacker.example/steamcommunity.com",
      "http://steamcommunity.com/id/player1",
      "https://steamcommunity.com/tradeoffer/new",
      "not-a-url",
    ];

    for (const legacyValue of invalidLegacyValues) {
      selectMock.mockImplementationOnce(() =>
        query([
          {
            ...baseUserRow,
            steamProfileUrl: legacyValue,
          },
        ]),
      );

      const result = await getPublicPlayerById("user-1");
      expect(result?.steamProfileUrl).toBeNull();
    }
  });

  it("keeps null for players without steamProfileUrl", async () => {
    selectMock.mockImplementationOnce(() =>
      query([
        {
          ...baseUserRow,
          steamProfileUrl: null,
        },
      ]),
    );

    const result = await getPublicPlayerById("user-1");
    expect(result?.steamProfileUrl).toBeNull();
  });
});
