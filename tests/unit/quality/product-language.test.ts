import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCT_LANGUAGE_ALLOWED, internalProductVocabulary, productLanguageViolations } from "tests/helpers/product-language";

// All page/component literals and presentation owners join the gate
// automatically. Legacy non-UI business messages use this explicit owner
// registry; AppError presentation owners are discovered from their canonical
// boundary instead.
const messageOwners = [
  "src/lib/competitive/conversion-policy.ts", "src/lib/competitive/conversion-policy-admin.ts",
  "src/lib/seasons/lifecycle.ts", "src/lib/my/readiness.ts", "src/lib/match-rosters/service.ts",
  "src/lib/competition-entries/presentation.ts", "src/lib/competition-entries/commands.ts",
  "src/lib/competition-entries/roster-change.ts", "src/lib/identity/self-service.ts",
  "src/lib/identity/merge.ts",
  "src/actions/competitive-platform.ts", "src/actions/conversion-policies.ts",
];
function sources(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sources(join(root, entry.name)) : /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [join(root, entry.name)] : []);
}

describe("product language contract", () => {
  it("keeps normal product text free of internal implementation vocabulary", () => {
    const presentationOwners = sources("src/lib").filter((path) => /(?:^|\/)[^/]*presentation\.tsx?$/.test(path));
    const files = [...sources("src/app"), ...sources("src/components").filter((path) => !path.includes("/components/rules/")), ...presentationOwners, ...messageOwners];
    expect(files.flatMap((path) => productLanguageViolations(path, readFileSync(path, "utf8")))).toEqual([]);
  });
  it("checks every expected AppError presentation owner without a manual registry", () => {
    const files = sources("src").filter((path) => {
      const text = readFileSync(path, "utf8");
      return text.includes("new AppError") || text.includes("AppError.withPresentation");
    });
    expect(files.flatMap((path) => productLanguageViolations(path, readFileSync(path, "utf8"), { expectedErrorsOnly: true }))).toEqual([]);
  });
  it("allows brands and esports vocabulary", () => {
    expect(PRODUCT_LANGUAGE_ALLOWED.map(internalProductVocabulary).filter(Boolean)).toEqual([]);
  });
  it("distinguishes rendered text, identifiers, comments and explicit technical detail", () => {
    const source = `// canonical schema\nconst policy = "approved";\nconst a = <div className="policy"><span>{policy === "approved" ? "已批准" : "草稿"}</span><details><summary>技术详情</summary>schema snapshot</details></div>;`;
    expect(productLanguageViolations("fixture.tsx", source)).toEqual([]);
    expect(productLanguageViolations("fixture.tsx", 'const a = <p>请检查 active migration</p>;')).toEqual(["fixture.tsx:1: 请检查 active migration"]);
    expect(productLanguageViolations("fixture.ts", 'throw new AppError(ErrorCode.VALIDATION_FAILED, "必须使用 approved policy");')).toHaveLength(1);
    expect(productLanguageViolations("fixture.tsx", `
      const a = <p>{row.status}</p>;
      const b = <p>{entry.domain}</p>;
      const c = <Badge>{item.kind}</Badge>;
      const d = <StatusBanner title={row.type} />;
      const e = <p>{STATUS[row.status] ?? row.status}</p>;
    `)).toEqual(expect.arrayContaining([
      expect.stringContaining("direct machine-value render: row.status"),
      expect.stringContaining("direct machine-value render: entry.domain"),
      expect.stringContaining("direct machine-value render: item.kind"),
      expect.stringContaining("direct machine-value render: row.type"),
      expect.stringContaining("raw machine-value fallback"),
    ]));
    expect(productLanguageViolations("fixture.tsx", `
      const a = <p>{presentMatchStatus(row.status).label}</p>;
      const b = <p>{STATUS[row.status] ?? "状态待确认"}</p>;
      const c = <div key={row.status} className={row.status === "ready" ? "ok" : "warn"} />;
    `)).toEqual([]);
    expect(productLanguageViolations("fixture.ts", 'throw new AppError(ErrorCode.VALIDATION_FAILED, "当前 StageRun 无效");')).toHaveLength(1);
    expect(productLanguageViolations("fixture.ts", 'throw new AppError(ErrorCode.INTERNAL_ERROR, "StageRun snapshot invariant broken");')).toEqual([]);
  });
  it("checks literals passed through local presentation helper parameters", () => {
    const source = `
      function item(key: string, label: string, detail: string) {
        return { key, label, detail };
      }
      const safe = item("safe-key", "正常标题", "正常说明");
      const unsafe = item("unsafe-key", "正常标题", "StageRun invalid");
    `;
    expect(productLanguageViolations("src/lib/example-presentation.ts", source)).toEqual([
      expect.stringContaining("StageRun invalid"),
    ]);
  });
  it("protects an unregistered presentation owner and indirect MESSAGES copy", () => {
    const source = `
      const MESSAGES = { unsafe: "当前 StageRun 不能继续" } as const;
      function unregisteredOwner() {
        return AppError.withPresentation(ErrorCode.VALIDATION_FAILED, {
          owner: "unregistered-owner",
          key: "unsafe",
          params: {},
          message: MESSAGES.unsafe,
        });
      }
    `;
    expect(productLanguageViolations("src/lib/unregistered-owner.ts", source, { expectedErrorsOnly: true })).toEqual([
      expect.stringContaining("当前 StageRun 不能继续"),
    ]);
  });
  it("protects pure-English indirect MESSAGES copy in an unregistered owner", () => {
    const source = `
      const MESSAGES = { unsafe: "StageRun invalid" } as const;
      function unregisteredOwner() {
        return AppError.withPresentation(ErrorCode.VALIDATION_FAILED, {
          owner: "unregistered-owner",
          key: "unsafe",
          params: {},
          message: MESSAGES.unsafe,
        });
      }
    `;
    expect(productLanguageViolations("src/lib/unregistered-owner.ts", source, { expectedErrorsOnly: true })).toEqual([
      expect.stringContaining("StageRun invalid"),
    ]);
  });
});
