import { describe, expect, it } from "vitest";
import { applyListQueryUpdates } from "./list-query";

describe("list URL updates", () => {
  it("preserves unrelated query keys", () => {
    const result = applyListQueryUpdates(
      new URLSearchParams("tab=users&filter=all&page=3"),
      { q: "alice" },
      { defaults: { q: "" } },
    );

    expect(result.toString()).toBe("tab=users&filter=all&q=alice");
  });

  it("deletes values equal to caller-provided defaults", () => {
    const result = applyListQueryUpdates(
      new URLSearchParams("status=pending&academic=enrolled"),
      { status: "pending", academic: "all" },
      { defaults: { status: "pending", academic: "all" } },
    );

    expect(result.toString()).toBe("");
  });

  it("resets page for filter, search, and sort changes", () => {
    const result = applyListQueryUpdates(
      new URLSearchParams("q=old&sort=oldest&page=4"),
      { sort: "newest" },
    );

    expect(result.toString()).toBe("q=old&sort=newest");
  });

  it("keeps filters when page is explicitly updated", () => {
    const result = applyListQueryUpdates(
      new URLSearchParams("q=alice&status=pending&page=2"),
      { page: 3 },
    );

    expect(result.toString()).toBe("q=alice&status=pending&page=3");
  });

});
