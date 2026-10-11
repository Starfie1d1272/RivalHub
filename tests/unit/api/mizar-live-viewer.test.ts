import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock } = vi.hoisted(() => ({ selectMock: vi.fn() }));

vi.mock("@/db/client", () => ({ db: { select: selectMock } }));
vi.mock("@/lib/observability/server", () => ({ logEvent: vi.fn(), captureException: vi.fn() }));

import { issueLiveViewerToken } from "@/lib/mizar/live";
import { GET } from "@/app/api/matches/[matchId]/live-viewer/route";
import { AppError, ErrorCode } from "@/lib/errors";

const matchId = "40000000-0000-4000-8000-000000000001";
const secret = "local-test-supabase-jwt-secret-32-chars-min";
function query(rows: unknown[]) {
  const builder = { from: () => builder, innerJoin: () => builder, leftJoin: () => builder, where: async () => rows };
  selectMock.mockReturnValue(builder);
}

function decodePayload(token: string): Record<string, unknown> {
  const [header, payload, signature] = token.split(".");
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  expect(signature).toBe(expected);
  return JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
}

describe("Mizar public live viewer token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SUPABASE_JWT_SECRET;
  });

  it("issues a five-minute, match-scoped, receive-only viewer JWT for a playing season", async () => {
    process.env.SUPABASE_JWT_SECRET = secret;
    query([{ id: matchId }]);

    const credential = await issueLiveViewerToken(matchId);
    expect(credential.topic).toBe(`match-live:${matchId}`);

    const payload = decodePayload(credential.token);
    expect(payload).toMatchObject({ role: "authenticated", scope: "live-viewer", matchId, iss: "rivalhub", aud: "authenticated" });
    expect(Number(payload.exp) - Number(payload.iat)).toBe(300);
    expect(credential.expiresAt).toBe(Number(payload.exp) * 1000);
    // A viewer token carries no producer or trusted-producer claim.
    expect(payload).not.toHaveProperty("installationId");
    expect(payload).not.toHaveProperty("competitionId");
    expect(payload).not.toHaveProperty("role_claim");
  });

  it("fails closed when the match is not publicly live", async () => {
    process.env.SUPABASE_JWT_SECRET = secret;
    query([]);
    await expect(issueLiveViewerToken(matchId)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("fails closed when no server-only signing secret is configured", async () => {
    query([{ id: matchId }]);
    await expect(issueLiveViewerToken(matchId)).rejects.toMatchObject({ code: ErrorCode.INTERNAL_ERROR });
    await expect(issueLiveViewerToken(matchId)).rejects.toBeInstanceOf(AppError);
  });

  it("rejects a malformed match id at the route boundary", async () => {
    const response = await GET(new Request("http://localhost:3000/api/matches/not-a-uuid/live-viewer"), { params: Promise.resolve({ matchId: "not-a-uuid" }) });
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("adds only a current healthy public cache context, partitioned by login and source boundary", async () => {
    process.env.SUPABASE_JWT_SECRET = secret;
    const row = { id: matchId, seasonId: "40000000-0000-4000-8000-000000000002", updatedAt: new Date(),
      manualTakeoverEpoch: null as number | null, contextRevision: "private-context", authorityRevision: 1, generation: 2, epoch: 3,
      mapId: "40000000-0000-4000-8000-000000000003", mapStartedAt: new Date(), mapCompletedAt: null as Date | null, phase: "gameplay", identity: "healthy", lineup: "healthy" };
    query([row]);
    const first = (await issueLiveViewerToken(matchId, "opaque-session-partition-a")).cacheContext!;
    expect(first).toMatchObject({ schemaVersion: "rivalhub.previous-live.v1", seasonId: row.seasonId, matchId, boundary: { authorityRevision: 1, generation: 2, epoch: 3, mapId: row.mapId } });
    expect(first.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain("private-context");
    expect(JSON.stringify(first)).not.toContain("opaque-session-partition-a");
    expect((await issueLiveViewerToken(matchId, "opaque-session-partition-b")).cacheContext!.revision).not.toBe(first.revision);
    row.epoch++;
    expect((await issueLiveViewerToken(matchId, "opaque-session-partition-a")).cacheContext!.revision).not.toBe(first.revision);
    row.manualTakeoverEpoch = row.epoch;
    expect((await issueLiveViewerToken(matchId, "opaque-session-partition-a")).cacheContext).toBeNull();
    row.manualTakeoverEpoch = null;
    row.identity = "unknown";
    expect((await issueLiveViewerToken(matchId, "opaque-session-partition-a")).cacheContext).toBeNull();
    expect((await issueLiveViewerToken(matchId)).cacheContext).toBeNull();
    row.identity = "healthy"; row.mapCompletedAt = new Date();
    expect((await issueLiveViewerToken(matchId, "opaque-session-partition-a")).cacheContext).toBeNull();
  });
});
