import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import fixture from "../../../tests/fixtures/contracts/mizar-live-real-derived.json";
import { parseLiveSnapshotV1 } from "@/lib/mizar/protocol";
import { projectPublicLive } from "@/lib/mizar/live-projection";
import { initialLiveViewerState, receivePublicLive } from "@/lib/mizar/live-viewer-state";
import { MatchRealtimeSurface } from "./MatchRealtime";
vi.mock("next/navigation", () => ({ useParams: () => ({ seasonSlug: "fixture" }) }));

// Protect the visible warning/identity boundary after a session remains pending
// review even though its latest producer frame now says matched.
describe("observed lineup LIVE warning", () => {
  it("keeps the review warning and renders a temporary account without a registered-player link", () => {
    const snapshot = parseLiveSnapshotV1(fixture.snapshot);
    snapshot.radar = null;
    snapshot.players = snapshot.players.map((player, index) => ({ ...player, sourcePlayerId: `765611900000000${String(index).padStart(2, "0")}`, lineupEvidence: "current", side: index < 5 ? "CT" : "T" }));
    snapshot.players[0]!.displayName = "现场临时账号";
    const known = snapshot.players[1]!;
    const frame = projectPublicLive(snapshot, 1, snapshot.producedAt, new Map([[known.sourcePlayerId, known.canonicalPlayerId!]]));
    const state = receivePublicLive(initialLiveViewerState(), frame, frame.matchId, 100);
    render(<MatchRealtimeSurface state={state} now={100} phase="gameplay" currentMapId={frame.map.mapId} />);
    expect(screen.getByText(/现场名单需核实/)).toBeVisible();
    expect(screen.getByText("现场临时账号").closest("a")).toBeNull();
    expect(screen.getByRole("link", { name: known.displayName! })).toHaveAttribute("href", `/players/${known.canonicalPlayerId}`);
  });
});
