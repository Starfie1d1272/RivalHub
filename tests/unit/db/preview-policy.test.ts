import { describe, expect, it } from "vitest";
import { assertReviewedColumns, exportQuery, OMITTED_COLUMNS, PREVIEW_COLUMNS } from "../../../scripts/db/preview/policy";

describe("sanitized mirror policy", () => {
  it("keeps public community and Team recruitment information while excluding private interest records", () => {
    expect(PREVIEW_COLUMNS.community_groups).toContain("join_url");
    expect(PREVIEW_COLUMNS.season_contacts).toContain("value");
    expect(PREVIEW_COLUMNS.recruitment_intents).toContain("team_id");
    expect(() => assertReviewedColumns("community_groups", PREVIEW_COLUMNS.community_groups.split(" "))).not.toThrow();
    expect(exportQuery("users")).not.toContain("auth_id");
    expect(exportQuery("users")).toContain("@preview.invalid");
  });

  it("projects a fixed end reason without selecting the private source field", () => {
    const query = exportQuery("team_memberships");

    expect(query).toContain(`CASE WHEN "ended_at" IS NOT NULL THEN 'left'::team_membership_end_reason ELSE NULL END AS ended_reason`);
    expect(query).not.toContain('"ended_reason"');
    expect(PREVIEW_COLUMNS.team_memberships).not.toContain("ended_reason");
    expect(OMITTED_COLUMNS.team_memberships).toBe("ended_reason");
  });

  it("fails closed on an unknown source column or unreviewed table", () => {
    expect(() => assertReviewedColumns("community_groups", [...PREVIEW_COLUMNS.community_groups.split(" "), "invite_token"])).toThrow();
    expect(() => assertReviewedColumns("private_unknown", ["id"])).toThrow();
  });
});
