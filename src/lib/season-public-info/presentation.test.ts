import { describe, expect, it } from "vitest";
import { isSafePublicHref, toPublicSeasonInfo } from "./presentation";

describe("season public information presentation", () => {
  it("hides closed group join facts and storage path", () => {
    const result = toPublicSeasonInfo(null, [{ id: "closed", label: "旧群", audience: null, status: "closed", groupNumber: "123", qrImagePath: "season/group/old.png", joinUrl: "https://example.com/join", note: "历史群", sortOrder: 0 }], []);
    expect(result.groups[0]).toMatchObject({ status: "closed", groupNumber: null, qrImageUrl: null, joinUrl: null });
    expect(JSON.stringify(result)).not.toContain("old.png");
  });

  it("preserves configured group order and drops unsafe public links", () => {
    const result = toPublicSeasonInfo(
      { rulesLabel: "规则", rulesHref: "//evil.example/rules" },
      [
        { id: "second", label: "第二群", audience: null, status: "active", groupNumber: "2", qrImagePath: null, joinUrl: "//evil.example/join", note: null, sortOrder: 2 },
        { id: "first", label: "第一群", audience: null, status: "active", groupNumber: "1", qrImagePath: null, joinUrl: "https://example.com/join", note: null, sortOrder: 1 },
      ],
      [{ id: "contact", label: "联系", publicName: null, value: "联系我", href: "javascript:alert(1)", note: null, sortOrder: 0 }],
    );

    expect(result.rules.href).toBe("/rules");
    expect(result.groups.map((group) => group.id)).toEqual(["first", "second"]);
    expect(result.groups[0]?.joinUrl).toBe("https://example.com/join");
    expect(result.groups[1]?.joinUrl).toBeNull();
    expect(result.contacts[0]?.href).toBeNull();
  });

  it("keeps an explicit mailto contact link without allowing it for generic links", () => {
    const result = toPublicSeasonInfo(null, [], [{ id: "contact", label: "赛委会", publicName: null, value: "team@example.com", href: "mailto:team@example.com", note: null, sortOrder: 0 }]);
    expect(result.contacts[0]?.href).toBe("mailto:team@example.com");
    expect(isSafePublicHref("mailto:team@example.com")).toBe(false);
    expect(isSafePublicHref("mailto:team@example.com", { allowMailto: true })).toBe(true);
  });

  it("preserves configured contact order", () => {
    const result = toPublicSeasonInfo(null, [], [
      { id: "second", label: "第二联系人", publicName: null, value: "2", href: null, note: null, sortOrder: 2 },
      { id: "first", label: "第一联系人", publicName: null, value: "1", href: null, note: null, sortOrder: 1 },
    ]);
    expect(result.contacts.map((contact) => contact.id)).toEqual(["first", "second"]);
  });

  it("allows same-site paths and explicit HTTP(S) URLs only", () => {
    expect(isSafePublicHref("/rules?season=major")).toBe(true);
    expect(isSafePublicHref("HTTPS://example.com/rules")).toBe(true);
    expect(isSafePublicHref("//example.com/rules")).toBe(false);
    expect(isSafePublicHref("javascript:alert(1)")).toBe(false);
    expect(isSafePublicHref("/\\\\evil.example")).toBe(false);
  });
});
