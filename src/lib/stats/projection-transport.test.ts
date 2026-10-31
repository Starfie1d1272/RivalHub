import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildTournamentPerformanceAnalyticsFromProjections, collectTournamentPerformanceMapProjection } from "@cs2dak/tournament";
import type { RivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { adaptStatsEvidence } from "./evidence-adapter";
import { projectPlayerAttributeProfile, compilePlayerAttributeBenchmark } from "./player-attributes";
import { decodePerformanceTransport, encodePerformanceTransport, ProjectionTransportIntegrityError } from "./projection-transport";

function fixture(name: string) {
  const evidence = JSON.parse(readFileSync(`tests/fixtures/demo-evidence/${name}-map-v1.json`, "utf8")) as RivalHubDemoEvidenceV1;
  if (name === "overtime") evidence.target.matchMapId = "20000000-0000-4000-8000-000000000004";
  const bindings = new Map(evidence.participants.map((p, index) => [p.steamId64, { userId: `player-${index}`, entryId: index < 5 ? evidence.target.entryAId : evidence.target.entryBId }]));
  return collectTournamentPerformanceMapProjection(adaptStatsEvidence(evidence, bindings).performance);
}
function envelope(raw: Buffer) {
  return { version: 1, codec: "gzip-base64", uncompressedBytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex"), payload: gzipSync(raw).toString("base64") };
}

describe("performance transport", () => {
  it("preserves normal, overtime and mixed-map DAK analytics and benchmark", async () => {
    const legacy = [fixture("normal"), fixture("overtime")];
    const sidecars = await Promise.all(legacy.map(encodePerformanceTransport));
    expect(sidecars.every(Boolean)).toBe(true);
    const decoded = await Promise.all(sidecars.map(decodePerformanceTransport));
    expect(decoded).toEqual(legacy);
    const before = buildTournamentPerformanceAnalyticsFromProjections(legacy);
    const after = buildTournamentPerformanceAnalyticsFromProjections([legacy[0]!, decoded[1]!]);
    expect(after).toEqual(before);
    const benchmark = compilePlayerAttributeBenchmark(before.players);
    expect(compilePlayerAttributeBenchmark(after.players)).toEqual(benchmark);
    expect(after.players.map(player => projectPlayerAttributeProfile(player, benchmark))).toEqual(before.players.map(player => projectPlayerAttributeProfile(player, benchmark)));
  });
  it("rejects absent, unknown and corrupt encodings without legacy fallback", async () => {
    const valid = (await encodePerformanceTransport(fixture("normal")))!;
    for (const bad of [null, {}, { ...valid, version: 2 }, { ...valid, codec: "other" },
      { ...valid, payload: "!!!" }, { ...valid, payload: "A".repeat(349532) },
      { ...valid, uncompressedBytes: 1048577 }, { ...valid, uncompressedBytes: 1 },
      { ...valid, sha256: "0".repeat(64) }, envelope(Buffer.from([0xff])),
      envelope(Buffer.from("not json")), envelope(Buffer.from("[]")), envelope(Buffer.from('{}'))]) {
      await expect(decodePerformanceTransport(bad)).rejects.toBeInstanceOf(ProjectionTransportIntegrityError);
    }
  });
  it("retains legacy when the input exceeds its bound", async () => {
    const value = fixture("normal");
    value.data = "a".repeat(1048577);
    expect(await encodePerformanceTransport(value)).toBeNull();
  });
});
