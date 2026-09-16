import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRivalHubDemoEvidenceV1, type RivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "tests/fixtures/demo-evidence/normal-map-v1.json"), "utf8"),
) as unknown;

function cloneFixture(): RivalHubDemoEvidenceV1 {
  return structuredClone(parseRivalHubDemoEvidenceV1(fixture));
}

describe("Demo Evidence weapon breakdown suicide semantics", () => {
  it("keeps a world suicide in source facts without requiring a playerWeapons kill bucket", () => {
    const evidence = cloneFixture();
    const player = evidence.participants[0]!;
    evidence.sourceFacts.kills.push({
      roundSeq: 1,
      tick: 1,
      killerSteamId64: player.steamId64,
      victimSteamId64: player.steamId64,
      weapon: "world",
      headshot: false,
    });

    expect(() => parseRivalHubDemoEvidenceV1(evidence)).not.toThrow();
  });

  it("still requires a weapon bucket for a non-suicide player kill", () => {
    const evidence = cloneFixture();
    const killer = evidence.participants[0]!;
    const victim = evidence.participants[1]!;
    evidence.sourceFacts.kills.push({
      roundSeq: 1,
      tick: 1,
      killerSteamId64: killer.steamId64,
      victimSteamId64: victim.steamId64,
      weapon: "world",
      headshot: false,
    });

    expect(() => parseRivalHubDemoEvidenceV1(evidence)).toThrow(
      "playerWeapons 必须恰好覆盖 source kill weapon breakdown",
    );
  });
});
