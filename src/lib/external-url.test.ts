import { describe, expect, it } from "vitest";
import { isHttpUrl, isSteamProfileUrl, normalizeSteamProfileUrl } from "@/lib/external-url";

describe("external URL safety", () => {
  it("accepts only http and https URLs", () => {
    expect(isHttpUrl("https://video.example/match")).toBe(true);
    expect(isHttpUrl("http://live.example/room")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,unsafe")).toBe(false);
    expect(isHttpUrl("not a URL")).toBe(false);
  });
});

describe("normalizeSteamProfileUrl", () => {
  describe("允许并 canonicalize", () => {
    it("canonicalizes https profiles with 17 digits", () => {
      expect(
        normalizeSteamProfileUrl("https://steamcommunity.com/profiles/76561198000000001"),
      ).toBe("https://steamcommunity.com/profiles/76561198000000001");
      expect(
        normalizeSteamProfileUrl("https://steamcommunity.com/profiles/76561198000000001/"),
      ).toBe("https://steamcommunity.com/profiles/76561198000000001");
    });

    it("canonicalizes https vanity id", () => {
      expect(
        normalizeSteamProfileUrl("https://steamcommunity.com/id/example"),
      ).toBe("https://steamcommunity.com/id/example");
      expect(
        normalizeSteamProfileUrl("https://steamcommunity.com/id/example/"),
      ).toBe("https://steamcommunity.com/id/example");
    });

    it("trims surrounding whitespace", () => {
      expect(
        normalizeSteamProfileUrl("  https://steamcommunity.com/id/example  "),
      ).toBe("https://steamcommunity.com/id/example");
      expect(
        normalizeSteamProfileUrl(" \t https://steamcommunity.com/profiles/76561198000000001 \n "),
      ).toBe("https://steamcommunity.com/profiles/76561198000000001");
    });

    it("strips query and hash from valid root URL", () => {
      expect(
        normalizeSteamProfileUrl(" https://steamcommunity.com/id/example/?foo=1#bar "),
      ).toBe("https://steamcommunity.com/id/example");
      expect(
        normalizeSteamProfileUrl(
          "https://steamcommunity.com/profiles/76561198000000001?key=val&other=123#header",
        ),
      ).toBe("https://steamcommunity.com/profiles/76561198000000001");
    });

    it("preserves vanity casing and standard characters", () => {
      expect(
        normalizeSteamProfileUrl("https://steamcommunity.com/id/Test_Player-123"),
      ).toBe("https://steamcommunity.com/id/Test_Player-123");
    });
  });

  describe("拒绝", () => {
    it("rejects http scheme", () => {
      expect(normalizeSteamProfileUrl("http://steamcommunity.com/id/example")).toBeNull();
    });

    it("rejects sibling/attacker hosts (CodeQL bypass variants)", () => {
      expect(
        normalizeSteamProfileUrl("https://steamcommunity.com.attacker.example/id/example"),
      ).toBeNull();
      expect(
        normalizeSteamProfileUrl("https://attacker.example/steamcommunity.com"),
      ).toBeNull();
      expect(
        normalizeSteamProfileUrl("https://attacker.example/?next=steamcommunity.com"),
      ).toBeNull();
      expect(
        normalizeSteamProfileUrl("https://steamcommunity.com@attacker.example/id/example"),
      ).toBeNull();
    });

    it("rejects www.steamcommunity.com subdomain", () => {
      expect(
        normalizeSteamProfileUrl("https://www.steamcommunity.com/id/example"),
      ).toBeNull();
    });

    it("rejects non-default ports", () => {
      expect(
        normalizeSteamProfileUrl("https://steamcommunity.com:444/id/example"),
      ).toBeNull();
    });

    it("rejects profiles without exact 17 digits", () => {
      expect(
        normalizeSteamProfileUrl("https://steamcommunity.com/profiles/not-17-digits"),
      ).toBeNull();
      expect(
        normalizeSteamProfileUrl("https://steamcommunity.com/profiles/1234567890123456"),
      ).toBeNull();
      expect(
        normalizeSteamProfileUrl("https://steamcommunity.com/profiles/123456789012345678"),
      ).toBeNull();
      expect(normalizeSteamProfileUrl("https://steamcommunity.com/profiles/")).toBeNull();
      expect(normalizeSteamProfileUrl("https://steamcommunity.com/profiles")).toBeNull();
    });

    it("rejects empty id segment", () => {
      expect(normalizeSteamProfileUrl("https://steamcommunity.com/id/")).toBeNull();
      expect(normalizeSteamProfileUrl("https://steamcommunity.com/id")).toBeNull();
    });

    it("rejects extra path segments and other Steam pages", () => {
      expect(
        normalizeSteamProfileUrl("https://steamcommunity.com/id/example/friends"),
      ).toBeNull();
      expect(
        normalizeSteamProfileUrl(
          "https://steamcommunity.com/profiles/76561198000000001/edit",
        ),
      ).toBeNull();
      expect(
        normalizeSteamProfileUrl("https://steamcommunity.com/tradeoffer/new/?partner=1"),
      ).toBeNull();
    });

    it("rejects encoded slash and backslash in identity/path", () => {
      expect(normalizeSteamProfileUrl("https://steamcommunity.com/id/foo%2fbar")).toBeNull();
      expect(normalizeSteamProfileUrl("https://steamcommunity.com/id/foo%2Fbar")).toBeNull();
      expect(normalizeSteamProfileUrl("https://steamcommunity.com/id/foo%5cbar")).toBeNull();
      expect(normalizeSteamProfileUrl("https://steamcommunity.com/id/foo%5Cbar")).toBeNull();
      expect(normalizeSteamProfileUrl("https://steamcommunity.com\\id\\example")).toBeNull();
    });

    it("rejects malformed, blank, or dot-only identities", () => {
      expect(normalizeSteamProfileUrl("malformed URL")).toBeNull();
      expect(normalizeSteamProfileUrl("")).toBeNull();
      expect(normalizeSteamProfileUrl("   ")).toBeNull();
      expect(normalizeSteamProfileUrl(null)).toBeNull();
      expect(normalizeSteamProfileUrl(undefined)).toBeNull();
      expect(normalizeSteamProfileUrl("https://steamcommunity.com/id/.")).toBeNull();
      expect(normalizeSteamProfileUrl("https://steamcommunity.com/id/..")).toBeNull();
      expect(normalizeSteamProfileUrl("https://steamcommunity.com/id/%20")).toBeNull();
    });
  });

  describe("isSteamProfileUrl convenience helper", () => {
    it("returns true for valid canonical profile URLs", () => {
      expect(
        isSteamProfileUrl("https://steamcommunity.com/profiles/76561198000000001"),
      ).toBe(true);
    });

    it("returns false for invalid profile URLs", () => {
      expect(
        isSteamProfileUrl("https://steamcommunity.com.attacker.example/id/test"),
      ).toBe(false);
      expect(isSteamProfileUrl(null)).toBe(false);
    });
  });
});

