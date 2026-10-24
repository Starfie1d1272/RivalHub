import { beforeEach, describe, expect, it, vi } from "vitest";
const access = vi.hoisted(() => vi.fn());
const view = vi.hoisted(() => vi.fn());
const run = vi.hoisted(() => vi.fn());
vi.mock("@/lib/matches/veto-room/access", () => ({ assertVetoRoomReadable: access }));
vi.mock("@/lib/matches/veto-room/read-model", () => ({ getVetoRoomView: view }));
vi.mock("@/lib/matches/veto-room/interaction", async original => ({ ...await original<typeof import("@/lib/matches/veto-room/interaction")>(), runVetoInteraction: run }));
vi.mock("@/lib/observability/route", () => ({ withRouteObservability: (_request: Request, _route: string, handler: () => unknown) => handler() }));
import { GET, POST } from "@/app/api/matches/[matchId]/veto-room/route";
import { AppError, ErrorCode } from "@/lib/errors";
const id = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ matchId: id }) };
const url = `http://127.0.0.1:3032/api/matches/${id}/veto-room`;
function post(body: unknown, origin = "https://match.example") {
  return new Request(url, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
describe("BP HTTP boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://match.example");
    access.mockResolvedValue(undefined);view.mockResolvedValue({ session: { revision: 2 } });run.mockResolvedValue({ outcome: "applied", room: {} });
  });
  it("returns private uncached reads only after the shared visibility guard", async () => {
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");expect(access).toHaveBeenCalledWith(id);
    access.mockRejectedValueOnce(new AppError(ErrorCode.MATCH_NOT_FOUND, "比赛不存在。"));
    view.mockClear();expect((await GET(new Request(url), context)).status).toBe(404);expect(view).not.toHaveBeenCalled();
  });
  it("rejects malformed IDs before reading", async () => {
    expect((await GET(new Request(url), {params:Promise.resolve({matchId:"invalid"})})).status).toBe(400);
    expect(access).not.toHaveBeenCalled();expect(view).not.toHaveBeenCalled();
  });
  it("rejects missing/foreign origins before executing, including proxy host mismatches", async () => {
    expect((await POST(post({operation:"reconcile"}, "https://foreign.example"),context)).status).toBe(403);
    const missing = new Request(url,{method:"POST",body:'{"operation":"reconcile"}'});
    expect((await POST(missing,context)).status).toBe(403);expect(run).not.toHaveBeenCalled();
    expect((await POST(post({operation:"reconcile"}),context)).status).toBe(200);
    expect(run).toHaveBeenCalledWith({operation:"reconcile",matchId:id},"route");
  });
  it("uses the URL target and validates command concurrency/idempotency fields", async () => {
    expect((await POST(post({operation:"command",command:{kind:"step",actionType:"ban",mapName:"de_nuke"}}),context)).status).toBe(400);
    expect(run).not.toHaveBeenCalled();
    const command={operation:"command",expectedRevision:2,expectedTurnKey:"ban-veto-a-opening",clientRequestId:id,command:{kind:"step",actionType:"ban",mapName:"de_nuke"}};
    expect((await POST(post({...command,matchId:"untrusted"}),context)).status).toBe(200);
    expect(run).toHaveBeenCalledWith({...command,matchId:id},"route");
  });
  it("rejects oversized streamed bodies and propagates authentication refusal", async () => {
    expect((await POST(post({operation:"reconcile",extra:"x".repeat(9000)}),context)).status).toBe(400);expect(run).not.toHaveBeenCalled();
    run.mockRejectedValueOnce(new AppError(ErrorCode.UNAUTHORIZED,"请先登录。"));
    expect((await POST(post({operation:"start",entryId:id,expectedRevision:0,expectedTurnKey:null}),context)).status).toBe(401);
  });
});
