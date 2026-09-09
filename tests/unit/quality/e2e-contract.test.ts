import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const e2eRoot = resolve(process.cwd(), "tests/e2e");

function e2eSources(directory = e2eRoot): Array<{ path: string; source: string }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return e2eSources(path);
    if (!/\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [{ path, source: readFileSync(path, "utf8") }];
  });
}

describe("browser evidence static contract", () => {
  it("rejects sleeps, network-idle readiness and optional critical assertions", () => {
    const source = e2eSources().map((entry) => entry.source).join("\n");
    expect(source).not.toMatch(/waitForTimeout\s*\(/);
    expect(source).not.toMatch(/waitUntil\s*:\s*["']networkidle["']/);
    expect(source).not.toMatch(/\.or\s*\(/);
    expect(source).not.toMatch(/\.isVisible\s*\(/);
    expect(source).not.toMatch(/timeout\s*:\s*(?:20|30|60)_?000/);
  });

  it("keeps exactly one UI password-login owner", () => {
    const statefulSources = e2eSources()
      .filter(({ path }) => /(?:flows|visual)\//.test(path))
      .map((entry) => entry.source);
    const uiLoginOwners = statefulSources.filter((source) => source.includes('getByLabel("邮箱地址")'));
    expect(uiLoginOwners).toHaveLength(1);
  });

  it("keeps fixture cleanup tied to the private credentials manifest and reports redacted diagnostics", () => {
    const fixture = readFileSync(resolve(e2eRoot, "fixtures.ts"), "utf8");
    expect(fixture).toContain('["cleanup", scenarioId, credentialsPath, scenarioProfile]');
    expect(fixture).toContain("redactText");
    expect(fixture).toContain("shortKey");
    expect(fixture).toContain("operation=${operation}");
    expect(fixture).toContain("exit=${exitCode}");
    expect(fixture).toContain("phase=${phase}");
  });

  it("keeps failure screenshots and flow-specific fixture profiles in the system evidence contract", () => {
    const fixture = readFileSync(resolve(e2eRoot, "fixtures.ts"), "utf8");
    const playwright = readFileSync(resolve(process.cwd(), "playwright.config.ts"), "utf8");
    const artifactPreparation = readFileSync(resolve(process.cwd(), "scripts/ci/prepare-system-artifacts.mjs"), "utf8");
    expect(playwright).toContain('screenshot: "only-on-failure"');
    expect(artifactPreparation).toContain("allowFailureScreenshots: true");
    expect(fixture).toContain("scenarioProfile");
    expect(fixture).toContain("profile");
  });

  it("keeps constrained Team inputs on the short fixture key", () => {
    const majorEntry = readFileSync(resolve(e2eRoot, "flows/major-entry.spec.ts"), "utf8");
    const invitations = readFileSync(resolve(e2eRoot, "flows/team-invitations.spec.ts"), "utf8");
    expect(majorEntry).toContain("E2E 队伍 ${scenario.shortKey}");
    expect(majorEntry).not.toContain("E2E 队伍 ${scenario.scenarioId}");
    expect(invitations).toContain("scenario.invitationTeam.name");
    expect(invitations).not.toContain("E2E 邀请队伍 ${scenario.scenarioId}");
  });
});
