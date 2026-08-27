import { describe, it, expect } from "vitest";
import {
  resolveSanctionStatus,
  sanctionBlocks,
  serializeSanctionPublic,
} from "@/lib/discipline/service";
import type { DisciplinaryCase } from "@/db/schema";

const NOW = new Date("2026-08-27T12:00:00Z");

function baseCase(overrides: Partial<DisciplinaryCase> = {}): DisciplinaryCase {
  return {
    id: "case-1",
    seasonId: "season-1",
    subjectUserId: "user-1",
    status: "active",
    effects: ["registration_block"],
    internalEvidence: null,
    publicExplanation: null,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveUntil: null,
    issuedBy: "admin",
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as DisciplinaryCase;
}

describe("resolveSanctionStatus", () => {
  it("keeps draft rows inert regardless of window", () => {
    expect(resolveSanctionStatus(baseCase({ status: "draft" }), NOW)).toBe("draft");
  });

  it("resolves an active open-ended row as active", () => {
    expect(resolveSanctionStatus(baseCase(), NOW)).toBe("active");
  });

  it("resolves an upcoming active row as draft (not yet in force)", () => {
    const row = baseCase({ effectiveFrom: new Date("2026-09-01T00:00:00Z") });
    expect(resolveSanctionStatus(row, NOW)).toBe("draft");
  });

  it("resolves a passed-window active row as expired", () => {
    const row = baseCase({ effectiveUntil: new Date("2026-06-01T00:00:00Z") });
    expect(resolveSanctionStatus(row, NOW)).toBe("expired");
  });

  it("revoked overrides everything", () => {
    const row = baseCase({ status: "revoked", revokedAt: NOW });
    expect(resolveSanctionStatus(row, NOW)).toBe("revoked");
  });
});

describe("sanctionBlocks", () => {
  it("blocks only the listed capability during an active window", () => {
    const row = baseCase({ effects: ["match_participation_block"] });
    expect(sanctionBlocks(row, "match_participation_block", NOW)).toBe(true);
    expect(sanctionBlocks(row, "registration_block", NOW)).toBe(false);
  });

  it("does not block once the window has expired or the case was revoked", () => {
    const expired = baseCase({ effectiveUntil: new Date("2026-02-01T00:00:00Z") });
    expect(sanctionBlocks(expired, "registration_block", NOW)).toBe(false);
    const revoked = baseCase({ status: "revoked", revokedAt: NOW });
    expect(sanctionBlocks(revoked, "registration_block", NOW)).toBe(false);
    expect(sanctionBlocks(baseCase({ status: "draft" }), "registration_block", NOW)).toBe(false);
  });
});

describe("serializeSanctionPublic", () => {
  it("never serializes internal evidence", () => {
    const row = baseCase({
      internalEvidence: "私密证据：聊天记录截图链接 https://internal.example/secret",
      publicExplanation: "因违规行为被禁赛",
      effects: ["roster_block"],
    });
    const serialized = serializeSanctionPublic(row, NOW);

    expect(serialized.explanation).toBe("因违规行为被禁赛");
    expect(serialized.effects).toEqual(["roster_block"]);
    const json = JSON.stringify(serialized);
    expect(json).not.toContain("私密证据");
    expect(json).not.toContain("internal.example");
    expect(Object.hasOwn(serialized, "internalEvidence")).toBe(false);
  });

  it("emits the derived status, not the raw stored column alone", () => {
    const passedWindow = baseCase({ effectiveUntil: new Date("2026-03-01T00:00:00Z") });
    expect(serializeSanctionPublic(passedWindow, NOW).status).toBe("expired");
  });
});
