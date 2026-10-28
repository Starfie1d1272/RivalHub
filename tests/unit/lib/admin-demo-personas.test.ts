import { afterEach, expect, it, vi } from "vitest";
import type { AdminDemoReviewMap } from "@/lib/admin/matches/types";
import { enrichAdminDemoReviewPersonas } from "@/lib/admin/matches/demo-personas";

const boundary = vi.hoisted(() => ({ profiles: vi.fn(), report: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { displayPool: true } }));
vi.mock("@/lib/steam-profiles", () => ({ loadOrFetchSteamProfiles: boundary.profiles }));
vi.mock("@/lib/observability/server", () => ({ captureException: boundary.report }));
afterEach(() => { vi.resetAllMocks(); });

const review = (): AdminDemoReviewMap => ({ importId: "import", matchMapId: "map", mapOrder: 1, mapName: "de_nuke",
  invalidPayload: false, message: "需要处理", resolvedCount: 9, blockingIssues: ["比分待核对"],
  participants: [{ entryId: "a", observedSteam64: "76561198000000000", demoName: "Observed", teamName: "Alpha",
    state: "confirmable", currentPlayer: null, retirableIdentityId: null, observedSteamProfile: null, note: null,
    candidates: [{ eventRosterMemberId: "member", entryId: "a", name: "Canonical", steam64: "76561198000000001" }] }],
});

it("isolates a display failure without altering canonical review decisions", async () => {
  const maps = [review()];
  const canonical = structuredClone(maps);
  boundary.profiles.mockRejectedValueOnce(new Error("provider unavailable"));
  await expect(enrichAdminDemoReviewPersonas(maps)).resolves.toBeUndefined();
  expect(maps).toEqual(canonical);
  expect(boundary.report).toHaveBeenCalledOnce();
});

it("only adds optional profile presentation on a successful enrichment", async () => {
  const maps = [review()];
  boundary.profiles.mockResolvedValueOnce(new Map([["76561198000000000", { personaName: "Persona", profileUrl: "https://steamcommunity.com/profiles/76561198000000000", avatarUrl: null }]]));
  await enrichAdminDemoReviewPersonas(maps);
  expect(maps[0]!.participants[0]!.observedSteamProfile?.personaName).toBe("Persona");
  expect(maps[0]!.participants[0]!.state).toBe("confirmable");
  expect(maps[0]!.blockingIssues).toEqual(["比分待核对"]);
  expect(boundary.report).not.toHaveBeenCalled();
});
