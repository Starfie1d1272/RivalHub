import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const routeRoot = resolve(projectRoot, "src/app");
const routeSpecialFilePattern = /(?:page|layout|loading|error)\.tsx$/;
const alignmentExceptions = new Set([
  "src/app/[seasonSlug]/layout.tsx",
  "src/components/layout/SeasonNav.tsx",
]);

function collectFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolutePath);
    return routeSpecialFilePattern.test(entry.name) ? [absolutePath] : [];
  });
}

function relativePath(path: string): string {
  return path.slice(projectRoot.length + 1).replaceAll("\\", "/");
}

function classStrings(source: string): string[] {
  return [...source.matchAll(/className\s*=\s*["`]([^"`]*)["`]/g)].map((match) => match[1] ?? "");
}

function hasLegacyPageShell(source: string): boolean {
  return classStrings(source).some((className) => {
    const tokens = new Set(className.split(/\s+/).filter(Boolean));
    const hasInnerWidth = [...tokens].some((token) => token.startsWith("max-w-"));
    const hasPageGutter = [...tokens].some((token) => token.startsWith("px-") || token.startsWith("py-"));
    return tokens.has("container") || (tokens.has("mx-auto") && hasInnerWidth && hasPageGutter);
  });
}

describe("page layout ownership", () => {
  it("does not reintroduce legacy page shells in route special files", () => {
    const files = [
      ...collectFiles(routeRoot),
      resolve(projectRoot, "src/components/rules/SpringHistoricalRules.tsx"),
      resolve(projectRoot, "src/components/layout/SeasonNav.tsx"),
    ];
    const violations = files.flatMap((file) => {
      const path = relativePath(file);
      if (alignmentExceptions.has(path)) return [];
      return hasLegacyPageShell(readFileSync(file, "utf8")) ? [path] : [];
    });

    expect(violations).toEqual([]);
  });

  it("keeps the season-admin workbench as the width owner", () => {
    const registrations = readFileSync(resolve(projectRoot, "src/app/admin/[seasonSlug]/registrations/page.tsx"), "utf8");
    const communityAwards = readFileSync(resolve(projectRoot, "src/app/admin/[seasonSlug]/community-awards/page.tsx"), "utf8");
    const settings = readFileSync(resolve(projectRoot, "src/app/admin/[seasonSlug]/settings/page.tsx"), "utf8");

    expect(registrations).not.toContain("max-w-3xl");
    expect(registrations).toContain("min-w-0 space-y-6");
    expect(communityAwards).not.toContain("container");
    expect(communityAwards).toContain("max-w-4xl");
    expect(settings).not.toContain("container");
    expect(settings).toContain("max-w-3xl");
  });

  it("keeps Match Detail normal, loading, and error states on standard width", () => {
    for (const path of [
      "src/app/[seasonSlug]/matches/[matchId]/page.tsx",
      "src/app/[seasonSlug]/matches/[matchId]/loading.tsx",
      "src/app/[seasonSlug]/matches/[matchId]/error.tsx",
    ]) {
      expect(readFileSync(resolve(projectRoot, path), "utf8")).toContain('variant="standard"');
    }
  });
});
