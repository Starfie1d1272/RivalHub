import { describe, expect, it } from "vitest";
import fixture from "../../../tests/fixtures/contracts/mizar-live-real-derived.json";
import { parseLiveSnapshotV1 } from "./protocol";
import { projectPublicLive } from "./live-projection";
import { publicPlayerLabels, presentBomb } from "./live-presentation";
import { fromPublicRadar } from "@mizar-hud/radar-view";
const snapshot = projectPublicLive(parseLiveSnapshotV1(fixture.snapshot), 1, fixture.snapshot.producedAt);
describe("public player labels", () => {
  it("feeds real projected identities into the shared adapter without changing positions", () => {
    const labels = publicPlayerLabels(snapshot.players);
    const radar = snapshot.radar!;
    const frame = fromPublicRadar({ ...radar, players: radar.players.map(p => ({ ...p, label: labels.get(p.sourcePlayerId) })) }, { boundary: "test", sequence: 1, current: true });
    expect(frame!.payload.players[0].label).toBe(labels.get(radar.players[0].sourcePlayerId));
    expect(frame!.payload.players[0].position).toEqual(radar.players[0].position);
    expect([...labels.values()]).toContain("FA");
  });
  it("keeps collision labels stable through reordering and side swaps, including Unicode", () => {
    const players = snapshot.players.slice(0, 4).map((p, i) => ({ ...p, displayName: ["Alpha", "Alex", "克里斯甜", "克里斯"][i] }));
    const labels = publicPlayerLabels(players);
    expect(new Set(labels.values()).size).toBe(4);
    for (const label of labels.values()) expect(Array.from(label).length).toBeLessThanOrEqual(3);
    expect(publicPlayerLabels([...players].reverse().map(p => ({ ...p, side: p.side === "CT" ? "T" : "CT" })))).toEqual(labels);
  });
  it("bounds duplicate labels even at the protocol player limit", () => {
    const players = Array.from({ length: 64 }, (_, i) => ({ ...snapshot.players[0], sourcePlayerId: String(i), displayName: "Alpha" }));
    const labels = [...publicPlayerLabels(players).values()];
    expect(new Set(labels).size).toBe(64);
    expect(labels.every(label => Array.from(label).length <= 3)).toBe(true);
  });
  it("omits ordinary bomb carrying but keeps actionable states", () => {
    const bomb = snapshot.bomb!;
    expect(presentBomb({ ...bomb, state: "carried", action: null })).toBeNull();
    expect(presentBomb({ ...bomb, state: "planted", action: null })).toBe("C4 已安放");
  });
});
