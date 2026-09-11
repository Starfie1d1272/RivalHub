import { describe, expect, it } from "vitest";
import { isAnnouncementAttentionEligible, selectAttentionAnnouncement, selectLatestAnnouncement, stripMarkdown, toAnnouncementExcerpt } from "./presentation";

const base = { status: "published" as const, requiresAttention: true, attentionUntil: null, scope: "site" as const, publishedAt: new Date("2026-09-10T00:00:00Z"), updatedAt: new Date("2026-09-10T00:00:00Z"), id: "a" };

describe("announcement presentation", () => {
  it("does not present expired attention as eligible", () => {
    expect(isAnnouncementAttentionEligible({ ...base, attentionUntil: new Date("2026-09-09T00:00:00Z") }, new Date("2026-09-10T00:00:00Z"))).toBe(false);
  });

  it("prefers current season attention over site attention", () => {
    const selected = selectAttentionAnnouncement([
      { ...base, id: "site", scope: "site" },
      { ...base, id: "season", scope: "season", publishedAt: new Date("2026-09-01T00:00:00Z") },
    ], "season-id");
    expect(selected?.id).toBe("season");
  });

  it("selects latest publication with stable updated/id tie breaks", () => {
    const selected = selectLatestAnnouncement([
      { ...base, id: "older" },
      { ...base, id: "newer", publishedAt: new Date("2026-09-11T00:00:00Z") },
    ]);
    expect(selected?.id).toBe("newer");
  });

  describe("markdown sanitization and excerpting", () => {
    it("strips bold, italic, links, lists, and code blocks from markdown", () => {
      const input = [
        "# 公告标题",
        "",
        "这是一段 **粗体** 和 *斜体* 文本，包含 [官方链接](https://example.com)。",
        "",
        "- 列表第一项",
        "- 列表第二项",
        "",
        "```typescript",
        "const secret = 42;",
        "```",
        "",
        "> 这是引用内容",
      ].join("\n");

      const stripped = stripMarkdown(input);
      expect(stripped).toContain("公告标题 这是一段 粗体 和 斜体 文本，包含 官方链接。");
      expect(stripped).toContain("列表第一项 列表第二项 这是引用内容");
      expect(stripped).not.toContain("**");
      expect(stripped).not.toContain("https://example.com");
      expect(stripped).not.toContain("const secret");
      expect(stripped).not.toContain("#");
      expect(stripped).not.toContain(">");
    });

    it("truncates long announcement bodies cleanly with ellipsis", () => {
      const longBody = "这是一段很长很长的公告正文，".repeat(10);
      const excerpt = toAnnouncementExcerpt(longBody, 30);
      expect(excerpt.length).toBe(31); // 30 chars + ellipsis
      expect(excerpt.endsWith("…")).toBe(true);
    });
  });
});