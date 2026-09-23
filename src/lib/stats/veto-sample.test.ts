import { describe, expect, it } from "vitest";
import { classifyVetoSample } from "./veto-sample";

describe("veto sample policy", () => {
  it("keeps a recorded veto valid even when the match later ends by forfeit", () => {
    expect(classifyVetoSample({ isForfeit: true }, true)).toBe("recorded");
  });

  it("treats a forfeit without a veto record as not applicable", () => {
    expect(classifyVetoSample({ isForfeit: true }, false)).toBe("not_applicable");
  });

  it("treats a normal finished match without veto data as missing", () => {
    expect(classifyVetoSample({ isForfeit: false }, false)).toBe("missing");
  });
});
