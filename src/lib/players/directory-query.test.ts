import { describe, expect, it } from "vitest";
import { matchesDirectorySearch, parseParticipantDirectoryQuery } from "./directory-query";

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
