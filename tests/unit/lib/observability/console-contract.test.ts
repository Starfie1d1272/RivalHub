import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("production observability console contract", () => {
  it("keeps naked console calls out of src", () => {
    const sourceRoot = join(process.cwd(), "src");
    const nakedConsole = /\bconsole\.(log|warn|error|info|debug|dir|trace)\s*\(/;
    const violations = sourceFiles(sourceRoot).filter((path) => nakedConsole.test(readFileSync(path, "utf8")));
    expect(violations).toEqual([]);
  });
});
