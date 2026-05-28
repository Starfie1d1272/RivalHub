import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { manifestSchema, killsSchema, playerStatsSchema, positionsSchema } from "./schemas";

const dir = join(process.cwd(), "docs/demo-export/example/package");
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf-8"));

describe("demo zod schemas 接受 example 包", () => {
  it("manifest", () => { expect(() => manifestSchema.parse(load("manifest.json"))).not.toThrow(); });
  it("kills", () => { expect(() => killsSchema.parse(load("kills.json"))).not.toThrow(); });
  it("player-stats", () => { expect(() => playerStatsSchema.parse(load("player-stats.json"))).not.toThrow(); });
  it("positions-1s", () => { expect(() => positionsSchema.parse(load("positions-1s.json"))).not.toThrow(); });
  it("拒绝 schemaVersion 不符", () => {
    expect(() => manifestSchema.parse({ ...load("manifest.json"), schemaVersion: "wrong/9" })).toThrow();
  });
});
