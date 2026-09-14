import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("education settings client boundary", () => {
  it("passes retry-safe context without selecting persisted evidence", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/settings/education/page.tsx"), "utf8");

    expect(source).toContain("institutionId: educationVerifications.institutionId");
    expect(source).toContain("institutionCode: institutions.moeInstitutionCode");
    expect(source).toContain("evidenceType: educationVerifications.evidenceType");
    expect(source).not.toContain("evidenceCode");
    expect(source).not.toContain("evidenceObjectKey");
  });
});
