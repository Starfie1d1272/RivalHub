import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readWorkspaceFile(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("seed command safety contract", () => {
  it("does not load .env.local and preserves explicit target guards", () => {
    const packageJson = JSON.parse(readWorkspaceFile("../../../package.json")) as {
      scripts?: Record<string, string>;
    };
    const seedScript = readWorkspaceFile("../../../scripts/seed.ts");
    const localWrapper = readWorkspaceFile("../../../scripts/db/local.ts");

    expect(packageJson.scripts?.seed).toContain("tsx scripts/seed.ts");
    expect(packageJson.scripts?.seed).not.toContain("--env-file");
    expect(packageJson.scripts?.seed).not.toContain(".env.local");
    expect(seedScript).toContain("assertDeclaredDatabaseTarget(process.env)");
    expect(localWrapper).toContain('run(tsxBin, ["scripts/seed.ts"], { env });');
    expect(localWrapper).toContain("buildLocalAppEnvironment");
  });
});
