import { describe, expect, it } from "vitest";
import { renderProductionReleaseNotes } from "../../../scripts/release/changelog";

const CHANGELOG = `# Changelog

## [2.9.7]

### Fixed

修复 2.9.7 routing。

## [2.9.6]

### Added

新增 2.9.6 平台概览。

## [2.9.5]

### Added

新增 2.9.5 DAK 投影。

## [2.9.4]

### Fixed

修复 2.9.4。
`;

describe("production delta release notes", () => {
  it("covers intermediate changelog entries without claiming the failed tag shipped", () => {
    const notes = renderProductionReleaseNotes(CHANGELOG, {
      previousReleaseTag: "v2.9.5",
      currentReleaseTag: "v2.9.7",
    });

    expect(notes).toContain("权威上一生产版本 v2.9.5");
    expect(notes).toContain("2.9.6 平台概览");
    expect(notes).toContain("2.9.7 routing");
    expect(notes).not.toContain("2.9.5 DAK 投影");
    expect(notes).toContain("不代表曾作为生产版本发布");
  });

  it("includes a consecutive successful release exactly once", () => {
    const notes = renderProductionReleaseNotes(
      `${CHANGELOG}\n## [2.9.8]\n\n### Fixed\n\n当前版本修复。\n`,
      { previousReleaseTag: "v2.9.7", currentReleaseTag: "v2.9.8" },
    );

    expect(notes.match(/当前版本修复。/g)).toHaveLength(1);
    expect(notes).not.toContain("2.9.6 平台概览");
  });

  it("fails closed when the current release has no changelog section", () => {
    expect(() => renderProductionReleaseNotes(CHANGELOG, {
      previousReleaseTag: "v2.9.5",
      currentReleaseTag: "v2.9.8",
    })).toThrow(/缺少当前版本 v2\.9\.8/);
  });
});
