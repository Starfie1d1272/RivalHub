import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(), getUserSession: vi.fn(), findSeason: vi.fn(), publicSeason: vi.fn(),
  transaction: vi.fn(), read: vi.fn(), claim: vi.fn(), refresh: vi.fn(),
}));
vi.mock("next/cache", () => ({revalidatePath:mocks.refresh}));
vi.mock("@/db/client", () => ({db:{query:{seasons:{findFirst:mocks.findSeason}},transaction:mocks.transaction}}));
vi.mock("@/lib/auth/session", () => ({requireAuth:mocks.requireAuth,getUserSession:mocks.getUserSession,requireSeasonAdmin:vi.fn(),auditActorId:vi.fn()}));
vi.mock("@/lib/data/public-seasons", () => ({getPublicOrAuthorizedDraftSeason:mocks.publicSeason}));
vi.mock("@/lib/bet/relief-data", () => ({readBetRelief:mocks.read}));
vi.mock("@/lib/bet/service", () => ({claimBetReliefInTx:mocks.claim,joinBetInTx:vi.fn(),stakeBetInTx:vi.fn(),operateBetInTx:vi.fn()}));
vi.mock("@/lib/bet/data", () => ({betBoard:vi.fn()}));
vi.mock("@/lib/match-rosters/service", () => ({lockMatchInTx:vi.fn()}));
vi.mock("@/lib/matches/map-start", () => ({startCanonicalMapInTx:vi.fn()}));
vi.mock("@/lib/postevent/guard", () => ({assertSeasonAllowsTournamentMutationInTx:vi.fn()}));
vi.mock("@/lib/action-utils", () => ({failValidation:(message:string)=>({success:false,error:message}),actionError:(_operation:string,error:Error)=>({success:false,error:error.message})}));
import { claimBetRelief, getBetRelief } from "@/actions/bet";
const seasonId="11111111-1111-4111-8111-111111111111";
const day="2026-10-12";
describe("wallet relief action authorization boundary",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();mocks.requireAuth.mockResolvedValue({userId:"trusted-session-user"});mocks.getUserSession.mockResolvedValue(null);
    mocks.findSeason.mockResolvedValue({slug:"test-event",competitionTemplate:"major"});mocks.publicSeason.mockResolvedValue({});
  });
  it("denies client identity, amounts or missing day before entering any transaction",async()=>{
    for(const input of [{seasonId,day,userId:"someone-else"},{seasonId,day,amount:"100"},{seasonId}]) expect((await claimBetRelief(input)).success).toBe(false);
    expect((await getBetRelief({seasonId,userId:"someone-else"})).success).toBe(false);
    expect(mocks.requireAuth).not.toHaveBeenCalled();expect(mocks.transaction).not.toHaveBeenCalled();expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("requires authentication and an authorized event before financial mutation",async()=>{
    mocks.requireAuth.mockRejectedValueOnce(new Error("login required"));
    expect((await claimBetRelief({seasonId,day})).success).toBe(false);expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.publicSeason.mockResolvedValueOnce(null);
    expect((await claimBetRelief({seasonId,day})).success).toBe(false);expect(mocks.transaction).not.toHaveBeenCalled();expect(mocks.claim).not.toHaveBeenCalled();
  });
});
