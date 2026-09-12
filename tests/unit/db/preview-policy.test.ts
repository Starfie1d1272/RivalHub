import { describe, expect, it } from "vitest";
import { assertReviewedColumns, exportQuery, PREVIEW_COLUMNS } from "../../../scripts/db/preview/policy";

describe("sanitized mirror policy", () => {
  it("keeps public community and Team recruitment information while excluding private interest records", () => {
    expect(PREVIEW_COLUMNS.community_groups).toContain("join_url");
    expect(PREVIEW_COLUMNS.season_contacts).toContain("value");
    expect(PREVIEW_COLUMNS.recruitment_intents).toContain("team_id");
    expect(() => assertReviewedColumns("community_groups", PREVIEW_COLUMNS.community_groups.split(" "))).not.toThrow();
    expect(exportQuery("users")).not.toContain("auth_id");
    expect(exportQuery("users")).toContain("@preview.invalid");
  });

  it("fails closed on an unknown source column or unreviewed table", () => {
    expect(() => assertReviewedColumns("community_groups", [...PREVIEW_COLUMNS.community_groups.split(" "), "invite_token"])).toThrow();
    expect(() => assertReviewedColumns("private_unknown", ["id"])).toThrow();
  });
});
