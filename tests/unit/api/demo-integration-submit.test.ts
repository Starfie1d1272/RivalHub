import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseRivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { ErrorCode } from "@/lib/errors";

const { transactionMock } = vi.hoisted(() => ({ transactionMock: vi.fn() }));

vi.mock("@/db/client", () => ({ db: { transaction: transactionMock } }));
vi.mock("@/lib/audit/write", () => ({ writeAuditInTx: vi.fn() }));

import {
  dakStableScoreboardValues,
  scoreboardStatDisplay,
  submitRivalHubEvidence,
} from "@/lib/demo-integration/submit";

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/demo-evidence/normal-map-v1.json"), "utf8")) as unknown;

describe("DAK evidence submit boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a season outside the pairing scope before opening persistence", async () => {
    await expect(submitRivalHubEvidence({
      input: fixture,
      pairingId: "20000000-0000-4000-8000-000000000001",
      pairingScope: { seasonIds: ["30000000-0000-4000-8000-000000000001"] },
      idempotencyKey: "dak-season-scope-test",
    })).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("compares OCR at Perfect scoreboard precision using DAK stable FK/MK/clutch semantics", () => {
    const evidence = parseRivalHubDemoEvidenceV1(fixture);
    const summary = evidence.summaries.playerMaps[0]!;
    const scoreboard = dakStableScoreboardValues(summary);

    expect(scoreboard.firstKills).toBe(summary.firstKills);
    expect(scoreboard.multiKills).toBe(summary.twoKillRounds + summary.threeKillRounds + summary.fourKillRounds + summary.fiveKillRounds);
    expect(scoreboard.clutches).toBe(summary.clutchWins);
    expect(scoreboardStatDisplay("adr", 82.11)).toBe("82.1");
    expect(scoreboardStatDisplay("adr", 82.14)).toBe("82.1");
    expect(scoreboardStatDisplay("adr", 82.16)).toBe("82.2");
    expect(scoreboardStatDisplay("kills", 7.4)).toBe("7");
    expect(scoreboardStatDisplay("kills", 7.6)).toBe("8");
  });
});
