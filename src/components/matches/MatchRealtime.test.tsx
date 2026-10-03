import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fixture from "../../../tests/fixtures/contracts/mizar-live-real-derived.json";
import { parseLiveSnapshotV1 } from "@/lib/mizar/protocol";
import { projectPublicLive } from "@/lib/mizar/live-projection";
import { initialLiveViewerState, receivePublicLive } from "@/lib/mizar/live-viewer-state";
import { MatchRealtimeSurface } from "./MatchRealtime";
import { MatchHeroHeader } from "./MatchHeroHeader";
import { MatchListScoreSurface } from "./MatchListLiveScore";
import { MatchMapSequence } from "./MatchMapSequence";
vi.mock("./MatchStatusBadge", () => ({ MatchStatusBadge: () => null }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
const snapshot = projectPublicLive(parseLiveSnapshotV1(fixture.snapshot), 1, fixture.snapshot.producedAt);
const state = receivePublicLive(initialLiveViewerState(), snapshot, snapshot.matchId, 0);
const render = (phase: "awaiting_gameplay" | "gameplay" | "inter_map", now = 0, currentMapId = snapshot.map.mapId) => renderToStaticMarkup(<MatchRealtimeSurface state={state} now={now} phase={phase} currentMapId={currentMapId} />);
describe("public LIVE presentation", () => {
  it("renders real public projection stats and SSR-safe radar without provenance or expanded equipment table", () => {
    const html = render("gameplay");
    expect(html).toContain("FalleN"); expect(html).toContain("KSCERATO");
    expect(html).toContain("K / D / A");
    expect(html).not.toContain("本图回合</span>");
    expect(html).toContain("战术雷达"); expect(html).toContain("Armor"); expect(html).toContain("Money");
    for (const forbidden of ["identityEvidence", "sourcePlayerId", "runtimeSeq", "OCR", "DAK", "弹药", "武器", "装备值", "kill feed"]) expect(html).not.toContain(forbidden);
  });
  it("freezes stale clock and hides time-sensitive data at unavailable", () => {
    expect(render("gameplay", 3001)).toContain("实时数据暂时中断");
    expect(render("gameplay", 3001)).toContain("1:38");
    expect(render("gameplay", 10000)).toContain("1:38");
    expect(render("gameplay", 10001)).not.toContain("FalleN");
    expect(render("gameplay", 10001)).not.toContain("战术雷达");
  });
  it("uses the same section in waiting/inter-map without exposing old map imagery", () => {
    for (const phase of ["awaiting_gameplay", "inter_map"] as const) {
      const html = render(phase);
      expect(html).toContain('data-testid="match-realtime"');
      expect(html).not.toContain("FalleN"); expect(html).not.toContain("回合时钟");
      expect(html).not.toContain("暂时中断");
    }
    expect(render("gameplay", 0, "other-map")).not.toContain("战术雷达");
  });
  it("preserves compact canonical map/series results during inter-map without stale telemetry", () => {
    const context = { phase: "inter_map" as const, currentMapId: "next", seriesProgress: { scoreA: 1, scoreB: 0 }, lastCompletedMap: { id: "previous", mapName: "de_ancient", scoreA: 13, scoreB: 9 } };
    const list = renderToStaticMarkup(<MatchListScoreSurface entryAId="a" entryBId="b" context={context} />);
    expect(list).toContain("13 : 9"); expect(list).toContain("(1)"); expect(list).toContain("(0)");
    expect(list).not.toContain("图间休息"); expect(list).not.toContain("等待下一图");
    const detail = renderToStaticMarkup(<MatchRealtimeSurface state={state} now={20_000} {...context} />);
    expect(detail).toContain("13:9"); expect(detail).not.toContain("战术雷达"); expect(detail).not.toContain("回合时钟");
  });
  it("reserves the hero scoreboard for final results", () => {
    const match = { id: "match", entryAId: "a", entryBId: "b", stage: "playoffs", format: "bo3" as const, status: "in_progress", scoreA: null, scoreB: null, scheduledAt: null, completedAt: null, bracketNodeId: null, isForfeit: false };
    const html = renderToStaticMarkup(<MatchHeroHeader seasonSlug="sample" match={match} teamA={null} teamB={null} isFinished={false} />);
    expect(html).toContain("VS");
    expect(html).not.toContain('aria-label="系列赛比分"');
    const unknown = renderToStaticMarkup(<MatchHeroHeader seasonSlug="sample" match={{ ...match, status: "finished", scoreA: 2, scoreB: 0 }} teamA={null} teamB={null} isFinished />);
    expect(unknown).not.toContain("VS"); expect(unknown).toContain('aria-label="系列赛比分"');
  });
  it("keeps BO3 2:0 unused decider distinct from an actual 2:1 result", () => {
    const maps = [1, 2, 3].map(order => ({ id: String(order), mapOrder: order, mapName: "de_ancient", pickedByEntryId: null, scoreA: order < 3 ? 13 : null, scoreB: order < 3 ? 9 : null, completedAt: order < 3 ? "2026-10-03T00:00:00Z" : null }));
    const html = renderToStaticMarkup(<MatchMapSequence maps={maps} currentMapId={null} entryAId="a" teamAName="A" teamBName="B" finished />);
    expect(html).toContain("未进行"); expect(html).not.toContain("当前地图");
    maps[1] = { ...maps[1], scoreA: 9, scoreB: 13 };
    maps[2] = { ...maps[2], scoreA: 16, scoreB: 14, completedAt: "2026-10-03T01:00:00Z" };
    const three = renderToStaticMarkup(<MatchMapSequence maps={maps} currentMapId={null} entryAId="a" teamAName="A" teamBName="B" finished />);
    expect(three).not.toContain("未进行"); expect(three).toContain("16 : 14");
  });
});
