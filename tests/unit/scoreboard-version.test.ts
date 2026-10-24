import { expect, it } from "vitest";
import type { ScoreboardVersionRow } from "@/lib/ocr/scoreboard-version";
import { scoreboardPayloadDigest, scoreboardVersion } from "@/lib/ocr/scoreboard-version";
import { assertScoreboardReplay, assertScoreboardVersion } from "@/lib/ocr/scoreboard-receipts";

const row: ScoreboardVersionRow = {
  id: "00000000-0000-4000-8000-000000000001", matchId: "match", mapId: "map", perfectName: "Synthetic player", userId: "user",
  kills: 20, deaths: 10, assists: 5, hsPercent: 30, firstKills: 2, firstDeaths: 1, multiKills: 1, tradeKills: 0, kastRounds: 14,
  clutches: 0, adr: 80, rws: 10, ratingPro: 1.2, we: 8, dakImportId: "private-dak-revision", verifiedByAdmin: "private-actor",
  verifiedAtExact: "2026-10-01 00:00:00.000001+00", createdAtExact: "2026-10-01 00:00:00+00",
  verifiedAt: new Date("2026-10-01T00:00:00Z"), createdAt: new Date("2026-10-01T00:00:00Z"),
};
it("includes private DAK/provenance changes in the opaque version independent of row order", () => {
  const second = { ...row, id: "00000000-0000-4000-8000-000000000002" };
  expect(scoreboardVersion("map", [row, second])).toBe(scoreboardVersion("map", [second, row]));
  expect(scoreboardVersion("map", [row])).toMatch(/^[a-f0-9]{64}$/);
  for (const changed of [{ dakImportId: "later-import" }, { verifiedByAdmin: "later-actor" }, { kills: 21 }, { ratingPro: 2 }, { verifiedAtExact: "2026-10-01 00:00:00.000002+00" }]) {
    expect(scoreboardVersion("map", [{ ...row, ...changed }])).not.toBe(scoreboardVersion("map", [row]));
  }
});
it("binds receipt replay to map, operation, base version and canonical input", () => {
  const command = { operationId: "original", expectedActor: "actor", expectedVersion: "a".repeat(64) };
  const digest = scoreboardPayloadDigest("map", "save", command, [{ userId: "user", ratingPro: 1.4 } as { userId: string }]);
  const receipt = { mapId: "map", operation: "save" as const, payloadDigest: digest };
  expect(() => assertScoreboardReplay(receipt, "map", "save", digest)).not.toThrow();
  expect(() => assertScoreboardReplay(receipt, "different", "save", digest)).toThrow();
  expect(() => assertScoreboardReplay(receipt, "map", "clear", digest)).toThrow();
  expect(scoreboardPayloadDigest("map", "save", { ...command, expectedVersion: "b".repeat(64) }, [{ userId: "user", ratingPro: 1.4 } as { userId: string }])).not.toBe(digest);
  expect(scoreboardPayloadDigest("map", "save", command, [{ userId: "user", ratingPro: 9 } as { userId: string }])).not.toBe(digest);
  expect(() => assertScoreboardVersion("current", "stale")).toThrow();
});
