import { describe, expect, it } from "vitest";
import { normalizeEducationReviewQuery } from "@/lib/education/admin-review";

describe("education review query normalization", () => {
  it("uses deterministic defaults for invalid values", () => {
    expect(normalizeEducationReviewQuery(new URLSearchParams({
      q: "  student  ",
      status: "unknown",
      institution: "not-a-uuid",
      academic: "other",
      sort: "recent",
      page: "0",
    }))).toEqual({
      q: "student",
      status: "pending",
      institution: undefined,
      academic: "all",
      sort: "oldest",
      page: 1,
      pageSize: 25,
    });
  });

  it("keeps valid filters and clamps malformed page values", () => {
    expect(normalizeEducationReviewQuery(new URLSearchParams({
      status: "all",
      institution: "11111111-1111-4111-8111-111111111111",
      academic: "graduated",
      sort: "recently_reviewed",
      page: "3",
    }))).toMatchObject({
      status: "all",
      institution: "11111111-1111-4111-8111-111111111111",
      academic: "graduated",
      sort: "recently_reviewed",
      page: 3,
      pageSize: 25,
    });
  });
});
