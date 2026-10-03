import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fixture from "../../../tests/fixtures/contracts/mizar-live-real-derived.json";
import { parseLiveSnapshotV1 } from "@/lib/mizar/protocol";
import { projectPublicLive } from "@/lib/mizar/live-projection";
import { initialLiveViewerState, receivePublicLive } from "@/lib/mizar/live-viewer-state";
import { publicRoundScore } from "@/lib/mizar/live-presentation";
import { MatchListScoreSurface } from "./MatchListLiveScore";
import { MatchMapSequence } from "./MatchMapSequence";
const snapshot = projectPublicLive(parseLiveSnapshotV1(fixture.snapshot), 1, fixture.snapshot.producedAt);
const live = { state: receivePublicLive(initialLiveViewerState(), snapshot, snapshot.matchId, 0), now: 0 };
vi.mock("./MatchLiveProvider", () => ({ useMatchLive: () => live }));
const entryAId = snapshot.teams.ct.entryId!;
const entryBId = snapshot.teams.t.entryId!;
const context = { phase: "gameplay" as const, currentMapId: snapshot.map.mapId, seriesProgress: null };
const renderList = (phase = context.phase as import("@/lib/matches/presentation-phase").MatchPresentationPhase) => renderToStaticMarkup(<MatchListScoreSurface entryAId={entryAId} entryBId={entryBId} context={{ ...context, phase }} />);
describe("public score surfaces", () => {
  it("maps CT/T round scores to canonical A/B after a side swap, never guesses unmatched teams", () => {
    expect(publicRoundScore(snapshot, entryAId, entryBId)).toEqual({ scoreA: 2, scoreB: 0 });
    expect(publicRoundScore(snapshot, entryBId, entryAId)).toEqual({ scoreA: 0, scoreB: 2 });
    expect(publicRoundScore(snapshot, "unknown", entryBId)).toBeNull();
  });
  it("shows current-map scores in the list and map card, labels stale and clears unavailable", () => {
    live.now = 0;
    expect(renderList()).toContain("Ancient");
    expect(renderList()).toContain('aria-label="本图回合比分"');
    const maps = [{ id: snapshot.map.mapId!, mapOrder: 1, mapName: "de_ancient", pickedByEntryId: entryAId, scoreA: null, scoreB: null, completedAt: null }];
    const mapCard = () => renderToStaticMarkup(<MatchMapSequence maps={maps} currentMapId={snapshot.map.mapId} entryAId={entryAId} entryBId={entryBId} teamAName="A" teamBName="B" phase="gameplay" finished={false} />);
    expect(mapCard()).toContain("2 : 0"); expect(mapCard()).toContain("本图回合");
    live.now = 3001;
    expect(renderList()).toContain("更新暂时中断"); expect(mapCard()).toContain("更新暂时中断");
    live.now = 10001;
    expect(renderList()).toContain("实时数据暂不可用");
    expect(renderList()).not.toContain('aria-label="本图回合比分"'); expect(mapCard()).not.toContain("2 : 0");
  });
  it("never presents a fresh old frame as gameplay during BP, waiting or inter-map", () => {
    live.now = 0;
    for (const phase of ["veto", "awaiting_gameplay", "inter_map"] as const) {
      expect(renderList(phase)).not.toContain('aria-label="本图回合比分"');
      expect(renderList(phase)).not.toContain("Ancient");
    }
  });
});
