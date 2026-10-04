import { describe, expect, it } from "vitest";
import { buildRecords, type RecordOccurrence } from "./records";
import { compareRecordValue } from "./record-facts";
const occurrence = (mapId: string, entityId = "p", numerator = 40): RecordOccurrence => ({ kind: "kills", entityId, entryId: "entry", numerator, denominator: 1,
  mapId, eventName: "赛事", eventSlug: "event", matchId: "match", mapName: "de_ancient", score: "13-16", rounds: 29, entityName: entityId, entityHref: `/players/${entityId}`, opponent: "对手" });
describe("scoped record book", () => {
  it("retains distinct occurrences and holders, deduplicates same facts, replaces only the level", () => {
    const rows = [occurrence("a"), occurrence("a"), occurrence("b"), occurrence("c", "other")];
    const record = buildRecords(rows)[0]!;
    expect(record.occurrenceCount).toBe(3);
    expect(record.holderCount).toBe(2);
    expect(record.occurrences.map((r) => r.mapId)).toEqual(["a", "b", "c"]);
    expect(buildRecords([...rows, occurrence("d", "p", 41)])[0]?.occurrenceCount).toBe(1);
    expect(buildRecords(rows)[0]?.occurrenceCount).toBe(3);
  });
  it("bounds payload but exposes all ties through pagination", () => {
    const rows = Array.from({ length: 24 }, (_, i) => occurrence(`map-${i}`, `p-${i}`));
    expect(buildRecords(rows)[0]).toMatchObject({ occurrenceCount: 24, holderCount: 24, pages: 3 });
    expect(buildRecords(rows)[0]?.occurrences).toHaveLength(10);
    expect(buildRecords(rows, 3)[0]?.occurrences).toHaveLength(4);
  });
  it("uses exact numerator/denominator ties, never rounded ADR", () => {
    expect(compareRecordValue({ numerator: 100, denominator: 10 }, { numerator: 200, denominator: 20 })).toBe(0);
    expect(compareRecordValue({ numerator: 10001, denominator: 1000 }, { numerator: 10002, denominator: 1000 })).toBeLessThan(0);
    const rows = [{ ...occurrence("a", "p", 10001), kind: "adr" as const, denominator: 1000 }, { ...occurrence("b", "p", 10002), kind: "adr" as const, denominator: 1000 }];
    expect(buildRecords(rows).find((r) => r.kind === "adr")?.occurrenceCount).toBe(1);
  });
  it("preserves multiple clutch rounds by the same holder and real zero map counts", () => {
    const rows = [1, 2].map((round) => ({ ...occurrence("same", "p", 4), kind: "clutch" as const, round }));
    expect(buildRecords(rows).find((r) => r.kind === "clutch")).toMatchObject({ value: 4, holderCount: 1, occurrenceCount: 2 });
    expect(buildRecords([occurrence("zero", "p", 0)])[0]?.value).toBe(0);
    expect(buildRecords([]).every((r) => r.value === null)).toBe(true);
  });
});
