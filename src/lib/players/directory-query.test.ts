import { describe, expect, it } from "vitest";
import { matchesDirectorySearch, parseParticipantDirectoryQuery, supportsRegistrationPositionDirectory } from "./directory-query";

describe("public participant directory query", () => {
  it("accepts a known team and normalizes search while rejecting ambiguous parameters", () => {
    expect(parseParticipantDirectoryQuery({ q: "  Alpha  ", team: "a" }, [{ id: "a" }])).toEqual({ q: "Alpha", team: "a" });
    expect(parseParticipantDirectoryQuery({ q: ["a", "b"], team: "private" }, [{ id: "a" }])).toEqual({ q: "", team: "" });
    expect(parseParticipantDirectoryQuery({ q: "a".repeat(120) }).q).toHaveLength(100);
  });
  it("finds a team by its name or any roster member without case sensitivity", () => {
    expect(matchesDirectorySearch("alpha", "Team", "ALPHA")).toBe(true);
    expect(matchesDirectorySearch("甲", "队伍", "选手甲")).toBe(true);
    expect(matchesDirectorySearch("missing", "Team", null)).toBe(false);
    expect(matchesDirectorySearch("", null)).toBe(true);
  });
});

describe("participant fact owners", () => {
  it("reserves registration position snapshots for Rivals instead of treating every non-Major event as Rivals", () => {
    expect(supportsRegistrationPositionDirectory("rivals")).toBe(true);
    expect(supportsRegistrationPositionDirectory("major")).toBe(false);
    expect(supportsRegistrationPositionDirectory("custom")).toBe(false);
  });
});
