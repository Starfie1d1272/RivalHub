import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Major browser fixture profile contract", () => {
  it("uses the one canonical Perfect identity field", () => {
    const fixture = readFileSync(new URL("../../../scripts/db/major-browser-fixture.ts", import.meta.url), "utf8");

    expect(fixture).toContain("perfect_name, steam64");
    expect(fixture).not.toContain("perfect_id");
  });
});
