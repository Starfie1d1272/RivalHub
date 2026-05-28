import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDemoPackage } from "./parse-package";

it("解析 example zip 返回 manifest 与各文件数组", async () => {
  const buf = readFileSync(join(process.cwd(), "docs/demo-export/example/rivalhub-demo-export-example.zip"));
  const result = await parseDemoPackage(buf);
  expect(result.manifest.mapName).toBe("de_mirage");
  expect(Array.isArray(result.files.kills)).toBe(true);
  expect(result.files.playerStats.length).toBeGreaterThan(0);
});
