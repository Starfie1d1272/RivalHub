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
it("authorizes the match season and forwards the exact reviewed execution", async () => {
 expect(await takeOverMatchMap(id, scope)).toMatchObject({success:true});
 expect(admin).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222");
 expect(takeover).toHaveBeenCalledWith(id, "actor", scope);
});
it("blocks unauthorized takeover and revocation before mutation", async () => {
 admin.mockRejectedValue(new Error("forbidden"));
 expect(await takeOverMatchMap(id,scope)).toMatchObject({success:false});
 expect(await revokeMatchInstallation(id,id)).toMatchObject({success:false});
 expect(takeover).not.toHaveBeenCalled(); expect(revoke).not.toHaveBeenCalled();
});
it("rejects malformed execution scope", async () => {
 expect(await takeOverMatchMap(id,{...scope,mapEpoch:-1})).toMatchObject({success:false}); expect(takeover).not.toHaveBeenCalled();
});

it("authorizes and forwards explicit canonical-map recovery through the same action", async () => {
 const recovery = { ...scope, recoverMapBinding: true };
 expect(await takeOverMatchMap(id, recovery)).toMatchObject({success:true});
 expect(takeover).toHaveBeenCalledWith(id, "actor", recovery);
 admin.mockRejectedValue(new Error("forbidden"));
 takeover.mockClear();
 expect(await takeOverMatchMap(id, recovery)).toMatchObject({success:false});
 expect(takeover).not.toHaveBeenCalled();
});

it("requires season administration for operator-reported collection failure", async () => {
 const reported = { ...scope, operatorReport: { reason: "采集断网", programSourceGeneration: 3, lastReliableSeq: 7, currentMapId: id } };
 expect(await takeOverMatchMap(id, reported)).toMatchObject({success:true});
 expect(takeover).toHaveBeenCalledWith(id, "actor", reported);
 admin.mockRejectedValue(new Error("forbidden"));
 takeover.mockClear();
 expect(await takeOverMatchMap(id, reported)).toMatchObject({success:false});
 expect(takeover).not.toHaveBeenCalled();
});
