import { beforeEach, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), season: vi.fn(), match: vi.fn(), options: vi.fn(), token: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAuth: mocks.auth }));
vi.mock("@/lib/data/public-seasons", () => ({ getPublicOrAuthorizedDraftSeason: mocks.season }));
vi.mock("@/db/client", () => ({ db: { query: { matches: { findFirst: mocks.match } } } }));
vi.mock("@/lib/community-awards/data", () => ({ getCommunityAwardFormOptions: mocks.options }));
vi.mock("@/lib/matches/public-refresh", () => ({ loadPublicMatchRefreshToken: mocks.token }));
import { loadCommunityAwardOptions } from "@/actions/community-award-options";
import { readPublicMatchRefreshToken } from "@/actions/public-match-refresh";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: "viewer" });
  mocks.season.mockResolvedValue({ id: "event", hasCommunityAwards: true, stagePlan: [] });
  mocks.match.mockResolvedValue({ id: "match" });
  mocks.options.mockResolvedValue({ candidates: [], matches: [] });
  mocks.token.mockResolvedValue("opaque");
});

// These assertions protect new transport gates, not the SQL tested in real PG.
it("requires fresh authentication and a visible capable event before form-only reads", async () => {
  mocks.auth.mockRejectedValueOnce(new AppError(ErrorCode.UNAUTHORIZED, "请登录"));
  expect(await loadCommunityAwardOptions("event")).toMatchObject({ success: false });
  expect(mocks.options).not.toHaveBeenCalled();
  mocks.season.mockResolvedValueOnce(null);
  expect(await loadCommunityAwardOptions("draft-event")).toMatchObject({ success: false });
  expect(mocks.options).not.toHaveBeenCalled();
  mocks.season.mockResolvedValueOnce({ id: "event", hasCommunityAwards: false });
  expect(await loadCommunityAwardOptions("event")).toMatchObject({ success: false });
  expect(mocks.options).not.toHaveBeenCalled();
  expect(await loadCommunityAwardOptions("event")).toMatchObject({ success: true });
});

it("rejects invalid, hidden and cross-event match scopes before producing a token", async () => {
  const input = { seasonSlug: "event", scope: { matchId: "11111111-1111-4111-8111-111111111111" } };
  expect(await readPublicMatchRefreshToken({ ...input, scope: { ...input.scope, stage: "stage1" } })).toMatchObject({ success: false });
  expect(mocks.season).not.toHaveBeenCalled();
  mocks.season.mockResolvedValueOnce(null);
  expect(await readPublicMatchRefreshToken(input)).toMatchObject({ success: false });
  expect(mocks.token).not.toHaveBeenCalled();
  mocks.match.mockResolvedValueOnce(null);
  expect(await readPublicMatchRefreshToken(input)).toMatchObject({ success: false });
  expect(mocks.token).not.toHaveBeenCalled();
  expect(await readPublicMatchRefreshToken(input)).toEqual({ success: true, data: "opaque" });
});
