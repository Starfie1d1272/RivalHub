import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCT_LANGUAGE_ALLOWED, internalProductVocabulary, productLanguageViolations } from "tests/helpers/product-language";

// All page/component literals join the gate automatically. Non-UI business
// messages use this explicit owner registry; schema and technical docs do not.
const messageOwners = [
  "src/lib/competitive/conversion-policy.ts", "src/lib/competitive/conversion-policy-admin.ts",
  "src/lib/seasons/lifecycle.ts", "src/lib/my/readiness.ts", "src/lib/match-rosters/service.ts",
  "src/lib/competition-entries/presentation.ts", "src/lib/competition-entries/commands.ts",
  "src/lib/competition-entries/roster-change.ts", "src/lib/identity/self-service.ts",
  "src/actions/competitive-platform.ts", "src/actions/conversion-policies.ts",
];
function sources(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sources(join(root, entry.name)) : /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [join(root, entry.name)] : []);
}

describe("product language contract", () => {
  it("keeps normal product text free of internal implementation vocabulary", () => {
    const files = [...sources("src/app"), ...sources("src/components").filter((path) => !path.includes("/components/rules/")), ...messageOwners];
    expect(files.flatMap((path) => productLanguageViolations(path, readFileSync(path, "utf8")))).toEqual([]);
  });
  it("allows brands and esports vocabulary", () => {
    expect(PRODUCT_LANGUAGE_ALLOWED.map(internalProductVocabulary).filter(Boolean)).toEqual([]);
  });
  it("distinguishes rendered text, identifiers, comments and explicit technical detail", () => {
    const source = `// canonical schema\nconst policy = "approved";\nconst a = <div className="policy"><span>{policy === "approved" ? "已批准" : "草稿"}</span><details><summary>技术详情</summary>schema snapshot</details></div>;`;
    expect(productLanguageViolations("fixture.tsx", source)).toEqual([]);
    expect(productLanguageViolations("fixture.tsx", 'const a = <p>请检查 active migration</p>;')).toEqual(["fixture.tsx:1: 请检查 active migration"]);
    expect(productLanguageViolations("fixture.ts", 'throw new AppError(ErrorCode.VALIDATION_FAILED, "必须使用 approved policy");')).toHaveLength(1);
  });
});
