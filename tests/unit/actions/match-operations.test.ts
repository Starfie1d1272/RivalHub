import { beforeEach, expect, it, vi } from "vitest";
const admin = vi.hoisted(() => vi.fn());
const takeover = vi.hoisted(() => vi.fn());
const revoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ requireSeasonAdmin: admin, auditActorId: () => "actor" }));
vi.mock("@/lib/action-utils", () => ({ getMatchOrThrow: async () => ({ seasonId: "22222222-2222-4222-8222-222222222222" }), getSeasonOrThrow: async () => ({slug:"season"}), actionError: () => ({ success:false }) }));
vi.mock("@/lib/mizar/source", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/mizar/source")>(),
  takeOverCurrentMap: takeover,
}));
vi.mock("@/lib/mizar/installation", () => ({ revokeMizarInstallation: revoke }));
vi.mock("@/lib/revalidation", () => ({ revalidateMatchPaths:vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath:vi.fn() }));
import { takeOverMatchMap, revokeMatchInstallation } from "@/actions/match-operations";
const id = "11111111-1111-4111-8111-111111111111";
const scope = { sessionId:id, mapId:id, mapEpoch:1 };
beforeEach(() => { vi.clearAllMocks(); admin.mockResolvedValue({userId:"actor"}); });
it("blocks unauthorized takeover and revocation before mutation", async () => {
 admin.mockRejectedValue(new Error("forbidden"));
 expect(await takeOverMatchMap(id,scope)).toMatchObject({success:false});
 expect(await revokeMatchInstallation(id,id)).toMatchObject({success:false});
 expect(takeover).not.toHaveBeenCalled(); expect(revoke).not.toHaveBeenCalled();
});
