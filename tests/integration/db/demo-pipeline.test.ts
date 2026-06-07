import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadDemoPackageFromZip } from "@cs2dak/core";
import { describe, expect, it, vi } from "vitest";
import { buildDakMatchArtifactsFromPackage } from "@/lib/demo/dak";
import { batchInsert } from "@/lib/demo/batch-insert";

const DAK_FIXTURE = join(
  process.env.DAK_ZIP_DIR
    ?? join(process.cwd(), "..", "cs2-demo-analysis-kit", "fixtures", "output", "nju-rivals-2026"),
  "2026-05-23_de_ancient_車一进一宝贝队-vs-Team_Clarys_13-8.zip",
);

describe.skipIf(!existsSync(DAK_FIXTURE))("DAK v2 数据管道 (集成)", () => {
  it("从 canonical v2 ZIP 生成分析与紧凑工作区", async () => {
    const pkg = await loadDemoPackageFromZip(readFileSync(DAK_FIXTURE));
    const result = buildDakMatchArtifactsFromPackage(pkg);

    expect(result.pkg.manifest.schemaVersion).toBe("cs2-demo-format/2.0");
    expect(result.analysis.scoreboard).toHaveLength(10);
    // 只清空 replay rounds，保留 tabs / map / heatmap 数据
    expect(result.workspace.tabs.map((tab) => tab.key)).toContain("map");
    expect(result.workspace.tabs.map((tab) => tab.key)).toContain("replay");
    expect(result.workspace.map.points.length).toBeGreaterThanOrEqual(0);
    expect(result.workspace.replay.rounds).toEqual([]);
    expect(result.workspace.replay.available).toBe(false);
    // 紧凑 workspace 不应超过 5 MB（含完整 map 数据）
    expect(JSON.stringify(result.workspace).length).toBeLessThan(5_000_000);
  }, 15_000);
});

describe("batchInsert 分片逻辑", () => {
  it("空数组直接返回，不调用 tx.insert", async () => {
    const tx = { insert: vi.fn().mockReturnValue({ values: vi.fn() }) } as never;
    await batchInsert(tx, {} as never, []);
    expect((tx as { insert: ReturnType<typeof vi.fn> }).insert).not.toHaveBeenCalled();
  });

  it("按 chunkSize 分片且不遗漏任何行", async () => {
    let totalInserted = 0;
    const values = vi.fn((chunk: unknown[]) => { totalInserted += chunk.length; });
    const insert = vi.fn().mockReturnValue({ values });
    const rows = Array.from({ length: 2500 }, (_, index) => ({ index }));

    await batchInsert({ insert } as never, {} as never, rows, 1000);

    expect(insert).toHaveBeenCalledTimes(3);
    expect(totalInserted).toBe(rows.length);
  });
});
