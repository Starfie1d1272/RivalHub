import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, logMock, captureMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), logMock: vi.fn(), captureMock: vi.fn() }));
vi.mock("@/lib/observability/fetch", () => ({ providerFetch: () => fetchMock }));
vi.mock("@/lib/observability/server", () => ({ logEvent: logMock, captureException: captureMock, traceOperation: (_name: string, _context: unknown, work: () => unknown) => work() }));
import { getSteamPlayerSummaries, resolveSteamAvatarForProfile } from "@/lib/steam";

const a = "76561198000000001";
const b = "76561198000000002";
const avatar = "https://avatars.steamstatic.com/new.jpg";
function response(players: Array<{ steamid: string; avatarfull: string }>) {
  return { ok: true, json: async () => ({ response: { players } }) };
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("STEAM_API_KEY", "unit-secret"); });
afterEach(() => vi.unstubAllEnvs());

describe("Steam avatar provider", () => {
  it("batches at 100 IDs, bypasses cache and returns only the requested safe projection", async () => {
    const ids = Array.from({ length: 205 }, (_, i) => (BigInt(a) + BigInt(i)).toString());
    fetchMock.mockImplementation(async (url: string) => response(new URL(url).searchParams.get("steamids")!.split(",").map((steamid) => ({ steamid, avatarfull: avatar }))));
    const result = await getSteamPlayerSummaries(ids);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.avatars.size).toBe(205);
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get("steamids")!.split(",").length)).toEqual([100, 100, 5]);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  });
  it("distinguishes a successful missing player from unavailable configuration", async () => {
    fetchMock.mockResolvedValue(response([]));
    expect(await getSteamPlayerSummaries([a])).toEqual({ status: "ok", avatars: new Map() });
    vi.stubEnv("STEAM_API_KEY", ""); fetchMock.mockClear();
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
    expect(captureMock.mock.calls[0][1].message).toBe("Steam avatar lookup failed");
    expect(JSON.stringify(captureMock.mock.calls)).not.toContain("unit-secret");
  });
  it("fails safely on malformed provider payloads", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ invalid: true }) });
    expect(await getSteamPlayerSummaries([a])).toEqual({ status: "failed" });
  });
});

describe("profile avatar write semantics", () => {
  it.each([null, a])("refreshes identity %s to B", async (oldSteam64) => {
    fetchMock.mockResolvedValue(response([{ steamid: b, avatarfull: avatar }]));
    expect(await resolveSteamAvatarForProfile({ steam64: oldSteam64, avatarUrl: oldSteam64 ? "old" : null }, b)).toBe(avatar);
  });
  it.each([null, a])("never keeps an old avatar after identity %s changes and provider fails", async (oldSteam64) => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await resolveSteamAvatarForProfile({ steam64: oldSteam64, avatarUrl: oldSteam64 ? "old" : null }, b)).toBeNull();
  });
  it("explicitly clears a removed Steam identity without provider I/O", async () => {
    expect(await resolveSteamAvatarForProfile({ steam64: a, avatarUrl: "old" }, null)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps a populated unchanged identity and heals a missing avatar", async () => {
    expect(await resolveSteamAvatarForProfile({ steam64: a, avatarUrl: "old" }, a)).toBe("old");
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(response([{ steamid: a, avatarfull: avatar }]));
    expect(await resolveSteamAvatarForProfile({ steam64: a, avatarUrl: null }, a)).toBe(avatar);
  });
});
