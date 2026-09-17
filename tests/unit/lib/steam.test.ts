import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, logMock, captureMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  logMock: vi.fn(),
  captureMock: vi.fn(),
}));

vi.mock("@/lib/observability/fetch", () => ({ providerFetch: () => fetchMock }));
vi.mock("@/lib/observability/server", () => ({
  logEvent: logMock,
  captureException: captureMock,
  traceOperation: (_name: string, _context: unknown, work: () => unknown) => work(),
}));

import { getSteamPlayerSummaries } from "@/lib/steam";

const a = "76561198000000001";
const avatar = "https://avatars.steamstatic.com/new.jpg";
const profileUrl = "https://steamcommunity.com/profiles/76561198000000001";

function response(players: Array<{ steamid: string; personaname: string; profileurl: string; avatarfull?: string | null }>) {
  return { ok: true, json: async () => ({ response: { players } }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STEAM_API_KEY", "unit-secret");
});

afterEach(() => vi.unstubAllEnvs());

describe("Steam official profile provider", () => {
  it("batches at 100 IDs, bypasses cache, and returns only the requested safe projection", async () => {
    const ids = Array.from({ length: 205 }, (_, i) => (BigInt(a) + BigInt(i)).toString());
    fetchMock.mockImplementation(async (url: string) => response(new URL(url).searchParams.get("steamids")!.split(",").map((steam64) => ({
      steamid: steam64,
      personaname: `Player ${steam64}`,
      profileurl: `https://steamcommunity.com/profiles/${steam64}`,
      avatarfull: avatar,
    }))));

    const result = await getSteamPlayerSummaries(ids);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.profiles.size).toBe(205);
      expect(result.profiles.get(a)).toEqual({
        steam64: a,
        personaName: `Player ${a}`,
        profileUrl,
        avatarUrl: avatar,
      });
    }
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get("steamids")!.split(",").length)).toEqual([100, 100, 5]);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  });

  it("distinguishes a successful missing player from unavailable configuration", async () => {
    fetchMock.mockResolvedValue(response([]));
    expect(await getSteamPlayerSummaries([a])).toEqual({ status: "ok", profiles: new Map() });

    vi.stubEnv("STEAM_API_KEY", "");
    fetchMock.mockClear();
    expect(await getSteamPlayerSummaries([a])).toEqual({ status: "unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([400, 429, 500, 503])("reports HTTP %i safely", async (status) => {
    fetchMock.mockResolvedValue({ ok: false, status });

    expect(await getSteamPlayerSummaries([a])).toEqual({ status: "failed" });
    expect(JSON.stringify(logMock.mock.calls)).not.toContain("unit-secret");
    expect(logMock).toHaveBeenCalledWith(expect.objectContaining({ safeContext: { provider: "steam", httpStatus: status } }));
  });

  it("does not copy credential-bearing network errors into observability", async () => {
    fetchMock.mockRejectedValue(new Error("timeout https://api.steampowered.com/?key=unit-secret"));

    expect(await getSteamPlayerSummaries([a])).toEqual({ status: "failed" });
    expect(captureMock.mock.calls[0]?.[1].message).toBe("Steam profile lookup failed");
    expect(JSON.stringify(captureMock.mock.calls)).not.toContain("unit-secret");
  });

  it("fails safely on malformed provider payloads", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ invalid: true }) });

    expect(await getSteamPlayerSummaries([a])).toEqual({ status: "failed" });
  });

  it("rejects non-HTTPS profile and avatar URLs from the provider", async () => {
    fetchMock.mockResolvedValue(response([{
      steamid: a,
      personaname: "Player A",
      profileurl: "http://steamcommunity.com/profiles/76561198000000001",
      avatarfull: "http://avatars.steamstatic.com/new.jpg",
    }]));

    expect(await getSteamPlayerSummaries([a])).toEqual({ status: "failed" });
  });

  it("keeps an official profile usable when Steam omits the avatar", async () => {
    fetchMock.mockResolvedValue(response([{
      steamid: a,
      personaname: "Player A",
      profileurl: profileUrl,
      avatarfull: null,
    }]));

    await expect(getSteamPlayerSummaries([a])).resolves.toEqual({
      status: "ok",
      profiles: new Map([[
        a,
        { steam64: a, personaName: "Player A", profileUrl, avatarUrl: null },
      ]]),
    });
  });
});
