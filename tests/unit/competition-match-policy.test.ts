import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TxDb } from "@/db/client";
import type { Match } from "@/db/schema";
const mocks = vi.hoisted(() => ({ defaults: vi.fn(), freeze: vi.fn() }));
vi.mock("@/lib/match-rosters/service", () => ({ materializeDefaultLineupsInTx: mocks.defaults, freezeEffectiveLineupsForStartInTx: mocks.freeze }));
import { prepareCompetitionMatchTransitionInTx } from "@/lib/matches/competition-policy";
const tx = {} as TxDb;
const match = { seasonId: "season", entryAId: "a", entryBId: "b", stage: "stage1", qualificationRunId: null } as Match;
const now = new Date();
beforeEach(() => { vi.resetAllMocks(); });
describe("existing competition start policy", () => {
  it("still refuses start when event lineup validation fails", async () => {
    mocks.freeze.mockRejectedValue(new Error("missing approved lineup"));
    await expect(prepareCompetitionMatchTransitionInTx(tx, match, "in_progress", now, "actor")).rejects.toThrow("missing approved lineup");
    expect(mocks.defaults).toHaveBeenCalledWith(tx, match, now, true);
    expect(mocks.freeze).toHaveBeenCalledWith(tx, match, now, "actor");
  });
  it("does not bypass failed default roster eligibility", async () => {
    mocks.defaults.mockRejectedValue(new Error("ineligible"));
    await expect(prepareCompetitionMatchTransitionInTx(tx, match, "in_progress", now, "actor")).rejects.toThrow("ineligible");
    expect(mocks.freeze).not.toHaveBeenCalled();
  });
  it("keeps qualification cancellation restricted", async () => {
    await expect(prepareCompetitionMatchTransitionInTx(tx, { ...match, qualificationRunId: "run" }, "cancelled", now, "actor")).rejects.toThrow("Play-in");
  });
});
