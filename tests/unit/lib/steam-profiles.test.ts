import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock, insertMock, executeMock, lookupMock, revalidateMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  insertMock: vi.fn(),
  executeMock: vi.fn(),
  lookupMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({ db: { select: selectMock, insert: insertMock, execute: executeMock } }));
vi.mock("@/db/schema", () => ({
  users: { id: "users.id", steam64: "users.steam64", status: "users.status" },
  steamProfiles: {
    steam64: "steam_profiles.steam64",
    personaName: "steam_profiles.persona_name",
    profileUrl: "steam_profiles.profile_url",
    avatarUrl: "steam_profiles.avatar_url",
  },
}));
vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn(), inArray: vi.fn(), isNotNull: vi.fn(), sql: vi.fn(() => "sql") }));
vi.mock("@/lib/steam", () => ({ getSteamPlayerSummaries: lookupMock }));
vi.mock("@/lib/revalidation", () => ({ revalidatePublicPlayerTag: revalidateMock }));

import { loadOrFetchSteamProfiles, refreshSteamProfiles } from "@/lib/steam-profiles";

const a = "76561198000000001";
const b = "76561198000000002";
const c = "76561198000000003";

const official = (steam64: string, suffix: string) => ({
  steam64,
  personaName: `Official ${suffix}`,
  profileUrl: `https://steamcommunity.com/profiles/${steam64}`,
  avatarUrl: `https://avatars.steamstatic.com/${suffix}.jpg`,
});

function selectResult(rows: unknown[]) {
  return { from: () => ({ where: async () => rows }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectMock
    .mockReturnValueOnce(selectResult([
      { id: "changed", steam64: a },
      { id: "same", steam64: b },
      { id: "missing", steam64: c },
    ]))
    .mockReturnValueOnce(selectResult([
      { steam64: a, personaName: "Old A", profileUrl: "https://steamcommunity.com/profiles/76561198000000001", avatarUrl: "https://avatars.steamstatic.com/old-a.jpg" },
      { steam64: b, personaName: "Official B", profileUrl: "https://steamcommunity.com/profiles/76561198000000002", avatarUrl: "https://avatars.steamstatic.com/B.jpg" },
    ]));
  lookupMock.mockResolvedValue({ status: "ok", profiles: new Map([[
    a,
    official(a, "A"),
  ], [
    b,
    official(b, "B"),
  ]]) });
  insertMock.mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    }),
  });
});

describe("Steam profile cache reconciliation", () => {
  it("updates changed official profiles, preserves missing results, and revalidates affected users without shadow writes", async () => {
    await expect(refreshSteamProfiles()).resolves.toEqual({ processed: 3, updated: 1, unresolved: 1 });

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.results[0]?.value.values).toHaveBeenCalledWith([
      expect.objectContaining({ steam64: a, personaName: "Official A" }),
    ]);
    expect(executeMock).not.toHaveBeenCalled();
    expect(revalidateMock).toHaveBeenCalledExactlyOnceWith("changed");
  });

  it.each(["unconfigured", "failed"])("rejects %s runs without modifying the cache", async (status) => {
    lookupMock.mockResolvedValue({ status });

    await expect(refreshSteamProfiles()).rejects.toThrow(status === "unconfigured" ? "STEAM_PROFILE_UNCONFIGURED" : "STEAM_PROFILE_PROVIDER_FAILED");
    expect(insertMock).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});

describe("loadOrFetchSteamProfiles cache owner", () => {
  it("returns cached profiles immediately without requesting the provider on cache hit", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue(selectResult([
        { steam64: a, personaName: "Official A", profileUrl: `https://steamcommunity.com/profiles/${a}`, avatarUrl: null },
      ])),
      insert: vi.fn(),
    };

    const result = await loadOrFetchSteamProfiles(mockDb as never, [a]);
    expect(result.get(a)).toMatchObject({ steam64: a, personaName: "Official A" });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("batch fetches multiple missing Steam64 values and persists them into steam_profiles", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const mockDb = {
      select: vi.fn().mockReturnValue(selectResult([])),
      insert: vi.fn().mockReturnValue({ values: valuesMock }),
    };

    lookupMock.mockResolvedValue({
      status: "ok",
      profiles: new Map([
        [a, official(a, "A")],
        [b, official(b, "B")],
      ]),
    });

    const result = await loadOrFetchSteamProfiles(mockDb as never, [a, b]);

    expect(lookupMock).toHaveBeenCalledExactlyOnceWith([a, b]);
    expect(result.size).toBe(2);
    expect(result.get(a)).toMatchObject({ steam64: a, personaName: "Official A" });
    expect(result.get(b)).toMatchObject({ steam64: b, personaName: "Official B" });
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(valuesMock).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ steam64: a, personaName: "Official A" }),
      expect.objectContaining({ steam64: b, personaName: "Official B" }),
    ]));
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it("gracefully degrades when provider fails or profile is not found", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue(selectResult([])),
      insert: vi.fn(),
    };

    lookupMock.mockResolvedValue({ status: "failed" });
    const failedResult = await loadOrFetchSteamProfiles(mockDb as never, [a]);
    expect(failedResult.size).toBe(0);

    lookupMock.mockRejectedValue(new Error("Network failure"));
    const errorResult = await loadOrFetchSteamProfiles(mockDb as never, [a]);
    expect(errorResult.size).toBe(0);

    lookupMock.mockResolvedValue({ status: "ok", profiles: new Map([[a, official(a, "A")]]) });
    const partialResult = await loadOrFetchSteamProfiles(mockDb as never, [a, c]);
    expect(partialResult.size).toBe(1);
    expect(partialResult.get(a)).toBeDefined();
    expect(partialResult.get(c)).toBeUndefined();
  });

  it("keeps database cache failures fail-closed instead of disguising them as provider degradation", async () => {
    const readDb = {
      select: vi.fn(() => { throw new Error("database read failed"); }),
      insert: vi.fn(),
    };
    await expect(loadOrFetchSteamProfiles(readDb as never, [a])).rejects.toThrow("database read failed");

    const writeFailure = new Error("database write failed");
    const writeDb = {
      select: vi.fn().mockReturnValue(selectResult([])),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockRejectedValue(writeFailure),
        }),
      }),
    };
    lookupMock.mockResolvedValue({ status: "ok", profiles: new Map([[a, official(a, "A")]]) });
    await expect(loadOrFetchSteamProfiles(writeDb as never, [a])).rejects.toThrow("database write failed");
  });

  it("does not query observed or historical steam64 during 6h periodic refresh", async () => {
    selectMock.mockReset();
    selectMock
      .mockReturnValueOnce(selectResult([]));

    await refreshSteamProfiles();
    expect(selectMock).toHaveBeenCalledTimes(1);
  });
});
