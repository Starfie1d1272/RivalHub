/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { takeOverMatchMap } from "@/actions/match-operations";
import type { Match } from "@/db/schema";
import { buildPerfectRoomGuide, projectOperatorWorkflow, type OperatorMap } from "@/lib/admin/matches/operator-workflow";

vi.mock("@/actions/match-operations", () => ({ takeOverMatchMap: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/matches/ClaimMatchButton", () => ({ ClaimMatchButton: () => <button>我来解说</button> }));
vi.mock("@/components/rivalhub", () => ({ Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, StatusPill: () => <span /> }));
vi.mock("@/components/ui/separator", () => ({ Separator: () => <hr /> }));
vi.mock("@/components/matches/AdminRosterDialog", () => ({ AdminRosterDialog: () => <div data-testid="roster-dialog">roster editor</div> }));
vi.mock("@/components/matches/VetoInputDialog", () => ({ VetoInputDialog: () => <div data-testid="veto-dialog">veto</div> }));
vi.mock("@/components/matches/ScoreInput", () => ({ ScoreInput: () => <div data-testid="score-input">score</div> }));
vi.mock("@/components/matches/MapByMapInput", () => ({ MapByMapInput: () => <div data-testid="map-input">maps</div> }));
vi.mock("@/components/matches/ScheduledAtInput", () => ({ ScheduledAtInput: () => <div data-testid="scheduled-input">schedule</div> }));
vi.mock("@/components/matches/ResultCorrectionPanel", () => ({ ResultCorrectionPanel: () => <div data-testid="result-correction">correction</div> }));
vi.mock("@/components/matches/StatsOCRPanel", () => ({ StatsOCRPanel: () => <div data-testid="ocr-panel">ocr</div> }));
vi.mock("@/components/matches/ForfeitButton", () => ({ ForfeitButton: () => <div data-testid="forfeit-button">forfeit</div> }));
vi.mock("@/components/matches/MapScoreCorrectInput", () => ({ MapScoreCorrectInput: () => <div data-testid="map-correction">map correction</div> }));
vi.mock("@/components/matches/DeleteMatchButton", () => ({ DeleteMatchButton: () => <div data-testid="delete-match">delete</div> }));
vi.mock("@/components/matches/CompletedAtInput", () => ({ CompletedAtInput: () => <div data-testid="completed-at">completed at</div> }));
vi.mock("@/components/matches/PreMatchOperatorChecklist", () => ({ PreMatchOperatorChecklist: () => <div data-testid="preflight">preflight</div> }));
vi.mock("@/components/matches/PostMatchRecordPanel", () => ({ PostMatchRecordPanel: () => <div data-testid="postmatch">postmatch</div> }));
vi.mock("@/components/matches/DemoDataReviewPanel", () => ({ DemoDataReviewPanel: ({ reviews }: { reviews: unknown[] }) => reviews.length ? <div data-testid="demo-review">demo review</div> : null }));

import { AdminMatchWorkbench } from "@/components/matches/AdminMatchWorkbench";

function data(status: Match["status"]) {
  const match = {
    id: "match-1",
    seasonId: "season-1",
    entryAId: "entry-a",
    entryBId: "entry-b",
    stage: "swiss",
    round: 1,
    format: "bo1" as const,
    entryRound: null,
    scoreA: status === "finished" ? 1 : null,
    scoreB: status === "finished" ? 0 : null,
    status,
    isForfeit: false,
    bracketNodeId: null,
    ownership: "major_stage" as const,
    majorStageRunId: "run-1",
    qualificationRunId: null,
    managedKey: "swiss:1:1",
    scheduledAt: new Date("2026-09-05T02:00:00Z"),
    startedAt: status === "scheduled" ? null : new Date("2026-09-05T02:05:00Z"),
    completionDeadline: null,
    completedAt: status === "finished" ? new Date("2026-09-05T04:00:00Z") : null,
    videoUrl: status === "finished" ? "https://video.example/match" : null,
    mvpWinnerUserId: null,
    createdAt: new Date("2026-09-05T00:00:00Z"),
    updatedAt: new Date("2026-09-05T00:00:00Z"),
  } satisfies Match;
  const roster = { rosterId: "roster-a", starters: ["a1", "a2", "a3", "a4", "a5"], substitutes: [], vetoRepresentativeEventRosterMemberId: null, status: "confirmed" as const };
  return {
    completion: { official: "已完赛", data: "待补齐 OCR / Demo", production: "不适用" },
    season: { id: "season-1", slug: "major", name: "Major" },
    stageName: "Swiss",
    match,
    teamAName: "Alpha",
    teamBName: "Beta",
    mapPool: ["de_inferno"],
    teamAMembers: ["a1", "a2", "a3", "a4", "a5"].map((id) => ({ id, entryId: "entry-a", personaName: id, displayName: null, perfectName: null, primaryPosition: "rifler", isCurrent: true })),
    teamBMembers: ["b1", "b2", "b3", "b4", "b5"].map((id) => ({ id, entryId: "entry-b", personaName: id, displayName: null, perfectName: null, primaryPosition: "rifler", isCurrent: true })),
    teamARoster: roster,
    teamBRoster: { ...roster, rosterId: "roster-b", starters: ["b1", "b2", "b3", "b4", "b5"] },
    teamAPreflight: { valid: true, blockers: [] },
    teamBPreflight: { valid: true, blockers: [] },
    completedMaps: status === "finished" ? [{ mapOrder: 1, mapName: "de_inferno", scoreA: 13, scoreB: 9, pickedByEntryId: null, teamAStartSide: "t" as const }] : [],
    pendingMaps: [],
    finishedMaps: status === "finished" ? [{ id: "map-1", mapName: "de_inferno", scoreA: 13, scoreB: 9 }] : [],
    vetoCompletedAt: status === "finished" ? new Date("2026-09-05T03:00:00Z") : null,
    postMatch: { commentators: [{ userId: "operator", name: "解说", hasLiveStream: false }], seasonAdmins: [], submittedAt: null, submittedByUserId: null, videoUrl: null, completionLabel: "待整理", canSubmit: status === "finished" },
    operator: { workflow: projectOperatorWorkflow({ status, isForfeit: false, vetoComplete: status !== "scheduled", observedGameplayMapId: null,
      maps: status === "finished" ? [{ id: "map-1", order: 1, name: "de_inferno", startSide: "t", completedAt: "2026-09-05T04:00:00Z", scoreboardComplete: false, demoLabel: "待上传", demoNeedsAttention: false }] : [] }), roomGuide: null },
    commentary: { currentMatches: [], nextMatch: null, unclaimedMatches: [], unclaimedCount: 0, byMatchId: {} },
  };
}

describe("AdminMatchWorkbench", () => {
  beforeEach(() => vi.stubGlobal("React", React));

  it("keeps scheduled lineup, execution and danger actions on the workbench", () => {
    render(<AdminMatchWorkbench {...data("scheduled")} />);

    expect(screen.getByRole("heading", { name: "首发名单" })).toBeInTheDocument();
    expect(screen.getByTestId("roster-dialog")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入 BP" })).toBeInTheDocument();
    expect(screen.getByTestId("forfeit-button")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "危险操作与恢复" })).toBeInTheDocument();
  });

  it("hides map scoring until the Veto map plan is complete", () => {
    const workbench = data("in_progress");
    const view = render(<AdminMatchWorkbench {...workbench} />);

    expect(screen.getByRole("status")).toHaveTextContent("BP 正在进行，完成后按地图计划建房");
    expect(screen.queryByTestId("map-input")).not.toBeInTheDocument();

    view.rerender(<AdminMatchWorkbench {...workbench} vetoCompletedAt={new Date("2026-09-05T03:00:00Z")} />);
    expect(screen.getByTestId("map-input")).toBeInTheDocument();
  });

  it("keeps finished roster visibility, post-match/OCR and recovery actions together", () => {
    render(<AdminMatchWorkbench {...data("finished")} />);

    expect(screen.getByText("首发：a1、a2、a3、a4、a5")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "赛后资料" })).toBeInTheDocument();
    expect(screen.getByTestId("ocr-panel")).toBeInTheDocument();
    expect(screen.getByTestId("result-correction")).toBeInTheDocument();
    expect(screen.getByText("危险操作与结果恢复")).toBeInTheDocument();
  });

  it("offers completed-map OCR during a series with an independent next-room path", () => {
    const workbench = data("in_progress");
    const maps: OperatorMap[] = [
      { id: "map-1", order: 1, name: "de_inferno", startSide: "ct", completedAt: "2026-09-05T04:00:00Z", scoreboardComplete: false, demoLabel: "待上传", demoNeedsAttention: false },
      { id: "map-2", order: 2, name: "de_nuke", startSide: "t", completedAt: null, scoreboardComplete: false, demoLabel: "待上传", demoNeedsAttention: false },
    ];
    const operator = { workflow: projectOperatorWorkflow({ status: "in_progress", isForfeit: false, vetoComplete: true, observedGameplayMapId: null, maps }),
      roomGuide: buildPerfectRoomGuide({ seasonName: "Major", roundLabel: "Stage1", description: "1-1", teamAName: "Alpha", teamBName: "Beta", map: maps[1] }) };
    render(<AdminMatchWorkbench {...workbench} operator={operator} />);
    expect(screen.getByTestId("ocr-panel")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下一图建房指引" })).toHaveAttribute("href", "#perfect-room-guide");
    expect(screen.getByRole("heading", { name: /Map 2.*Perfect 建房指引/ })).toBeInTheDocument();
  });

  it("makes Demo and post-match entry available even while final OCR is outstanding", () => {
    render(<AdminMatchWorkbench {...data("finished")} />);
    expect(screen.getByRole("link", { name: "获取 RivalHub Demo Uploader ↗" })).toHaveAttribute("href", "https://github.com/Starfie1d1272/cs2-demo-analysis-kit/releases/latest");
    expect(screen.getByTestId("postmatch")).toBeInTheDocument();
    expect(screen.getByTestId("ocr-panel")).toBeInTheDocument();
  });

  it("does not ask for OCR or Demo on a forfeit without actual maps", () => {
    const workbench = data("finished");
    render(<AdminMatchWorkbench {...workbench} match={{ ...workbench.match, isForfeit: true }} finishedMaps={[]} completedMaps={[]}
      operator={{ workflow: projectOperatorWorkflow({ status: "finished", isForfeit: true, vetoComplete: false, maps: [], observedGameplayMapId: null }), roomGuide: null }} />);
    expect(screen.queryByTestId("ocr-panel")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "获取 RivalHub Demo Uploader ↗" })).not.toBeInTheDocument();
    expect(screen.getByTestId("postmatch")).toBeInTheDocument();
  });

  it("keeps Demo recovery available when completed-map facts are missing", () => {
    const workbench = data("finished");
    render(<AdminMatchWorkbench {...workbench} finishedMaps={[]} completedMaps={[]}
      operator={{ workflow: projectOperatorWorkflow({ status: "finished", isForfeit: false, vetoComplete: false, maps: [], observedGameplayMapId: null }), roomGuide: null }}
      demoReviews={[{ importId: "import", matchMapId: "map-1", mapOrder: 1, mapName: "de_inferno", invalidPayload: false, message: "需要正式结果", resolvedCount: 0, blockingIssues: ["缺少地图正式结果"], participants: [] }]} />);
    expect(screen.queryByTestId("ocr-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("demo-review")).toBeInTheDocument();
  });
});

it("keeps AUTO as observation and makes review take precedence without a manual score form", () => {
 const props = data("in_progress"); props.vetoCompletedAt = new Date();
 const source = { currentMapId:"map-1", mapEpoch:1, manualTakeoverMapEpoch:null, identityHealth:"healthy", lineupHealth:"healthy", continuityHealth:"healthy", autoCanonicalizationArmed:true };
 const maps: OperatorMap[] = [{ id:"map-1", order:1, name:"de_inferno", startSide:"ct", completedAt:null, scoreboardComplete:false, demoLabel:"待上传", demoNeedsAttention:false }];
 props.operator.workflow = projectOperatorWorkflow({status:"in_progress", isForfeit:false, vetoComplete:true, observedGameplayMapId:"map-1", maps, source});
 const view = render(<AdminMatchWorkbench {...props} />);
 expect(screen.getByRole("heading",{name:"Map 1 · Inferno 进行中"})).toBeInTheDocument();
 expect(screen.queryByTestId("map-input")).not.toBeInTheDocument();
 props.operator.workflow = projectOperatorWorkflow({status:"in_progress", isForfeit:false, vetoComplete:true, observedGameplayMapId:"map-1", maps, source:{...source,lineupHealth:"conflict",autoCanonicalizationArmed:false}});
 view.rerender(<AdminMatchWorkbench {...props} />);
 expect(screen.getByRole("heading",{name:"比赛数据需要核对"})).toBeInTheDocument();
 expect(screen.queryByTestId("map-input")).not.toBeInTheDocument();
});

it("explains canonical-map recovery, requires confirmation, and forwards only the reviewed scope", async () => {
 const props = data("in_progress");
 const scope = { sessionId: "session", mapEpoch: 1, mapId: "map-1", recoverMapBinding: true };
 vi.mocked(takeOverMatchMap).mockResolvedValue({ success: true, data: undefined });
 const view = render(<AdminMatchWorkbench {...props} operator={{ ...props.operator, takeover: scope, recoveryMapLabel: "Map 1 · de_ancient" }} />);
 expect(screen.getByText(/请核对正式地图计划：Map 1/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: "确认当前地图并恢复手动录分" }));
 expect(takeOverMatchMap).not.toHaveBeenCalled();
 const changedScope = { ...scope, mapEpoch: 2 };
 view.rerender(<AdminMatchWorkbench {...props} operator={{ ...props.operator, takeover: changedScope, recoveryMapLabel: "Map 1 · de_ancient" }} />);
 expect(screen.queryByRole("button", { name: "确认：本图改用手动比分" })).not.toBeInTheDocument();
 view.rerender(<AdminMatchWorkbench {...props} operator={{ ...props.operator, takeover: scope, recoveryMapLabel: "Map 1 · de_ancient" }} />);
 fireEvent.click(screen.getByRole("button", { name: "确认当前地图并恢复手动录分" }));
 fireEvent.click(screen.getByRole("button", { name: "确认：本图改用手动比分" }));
 await waitFor(() => expect(takeOverMatchMap).toHaveBeenCalledWith(props.match.id, scope));
 view.unmount();
});

it("does not render an inter-map reminder or room guide during stale manual gameplay", () => {
 const props = data("in_progress"); props.vetoCompletedAt = new Date();
 const maps: OperatorMap[] = [1, 2].map(order => ({ id: `map-${order}`, order, name: "de_inferno", startSide: "ct", completedAt: order === 1 ? "2026-09-05T04:00:00Z" : null, scoreboardComplete: false, demoLabel: "待上传", demoNeedsAttention: false }));
 const workflow = projectOperatorWorkflow({ status: "in_progress", isForfeit: false, vetoComplete: true, maps, observedGameplayMapId: "map-2", source: { currentMapId: "map-2", mapEpoch: 2, manualTakeoverMapEpoch: 2, identityHealth: "healthy", lineupHealth: "healthy", continuityHealth: "stale", autoCanonicalizationArmed: false } });
 render(<AdminMatchWorkbench {...props} operator={{ workflow, roomGuide: null }} />);
 expect(screen.getByRole("heading", { name: "人工记录 Map 2 结果" })).toBeInTheDocument();
 expect(screen.getByTestId("map-input")).toBeInTheDocument();
 expect(screen.queryByText(/距 Map 1 结束|已超过 10 分钟|准备 Map 2 房间/)).not.toBeInTheDocument();
});

it("requires an operator problem report and confirmation without using browser elapsed time", async () => {
  const props = data("in_progress");
  const reportContext = { programSourceGeneration: 2, lastReliableSeq: 7, currentMapId: null };
  vi.mocked(takeOverMatchMap).mockClear();
  render(<AdminMatchWorkbench {...props} operator={{ ...props.operator, problemRecovery: { sessionId: "session", mapEpoch: 1, mapId: "map-1", recoverMapBinding: true, reportContext, mapLabel: "Map 1 · Ancient" } }} />);
  fireEvent.click(screen.getByRole("button", { name: "确认当前地图并恢复手动录分" }));
  expect(takeOverMatchMap).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("已确认的采集问题"), { target: { value: "采集电脑断网，已核对地图" } });
  fireEvent.click(screen.getByRole("button", { name: "确认当前地图并恢复手动录分" }));
  expect(takeOverMatchMap).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认：本图改用手动比分" }));
  await waitFor(() => expect(takeOverMatchMap).toHaveBeenCalledWith("match-1", expect.objectContaining({ operatorReport: { ...reportContext, reason: "采集电脑断网，已核对地图" } })));
});
