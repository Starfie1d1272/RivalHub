import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoots = [resolve(process.cwd(), "src/app"), resolve(process.cwd(), "src/components")];
const forbiddenTerms = ["长期队伍", "长期 Team", "active 队伍"];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("队伍用户界面术语", () => {
  it("不把内部队伍分类泄漏到页面或组件源码", () => {
    const violations = sourceRoots.flatMap((root) => sourceFiles(root)).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return forbiddenTerms.filter((term) => source.includes(term)).map((term) => `${path}: ${term}`);
    });

    expect(violations).toEqual([]);
  });
});
