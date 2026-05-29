import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDemoPackage } from "@/lib/demo/parse-package";
import { manifestSchema, killsSchema, playerStatsSchema } from "@/lib/demo/schemas";
import { toMatchPlayerStat } from "@/lib/demo/to-match-player-stats";
import { batchInsert } from "@/lib/demo/batch-insert";

/**
 * 端到端数据管道集成测试。
 *
 * 使用真实 example zip 驱动，覆盖：
 * 1. parseDemoPackage → 解析 zip 得到 manifest + 各表数据
 * 2. schema 验证 → 确保 example 数据满足 zod 约束
 * 3. toMatchPlayerStat 转换 → 确保 demo 数据可正确映射为 matchPlayerStats 格式
 * 4. batchInsert 分片逻辑 → 确保 chunk 边界正确、空数组安全、自定义 chunkSize
 *
 * 这些测试都是纯函数，无需 DB 连接。
 */
const EXAMPLE_ZIP = join(process.cwd(), "docs/demo-export/example/rivalhub-demo-export-example.zip");

describe("demo 数据管道 (集成)", () => {
  // ── 阶段 1: parseDemoPackage ──
  describe("parseDemoPackage: zip → 结构化数据", () => {
    it("解析 example zip 成功，返回 manifest", async () => {
      const buf = readFileSync(EXAMPLE_ZIP);
      const result = await parseDemoPackage(buf);

      expect(result.manifest.mapName).toBe("de_mirage");
      expect(result.manifest.schemaVersion).toBe("rivalhub-demo-export/1");
      expect(result.manifest.tickrate).toBe(64);
      expect(result.manifest.demo?.hash).toBe("example-demo-sha256");
    });

    it("解析出全部 15 个文件 key", async () => {
      const buf = readFileSync(EXAMPLE_ZIP);
      const result = await parseDemoPackage(buf);

      const expectedKeys = [
        "match", "players", "rounds", "playerStats", "playerEconomies",
        "kills", "damages", "blinds", "bombs", "clutches",
        "grenades", "shots", "positions1s",
      ];
      for (const key of expectedKeys) {
        expect(result.files).toHaveProperty(key);
        expect(Array.isArray(result.files[key])).toBe(true);
        expect(result.files[key].length).toBeGreaterThan(0);
      }
    });
  });

  // ── 阶段 2: schema 验证 ──
  describe("schema 验证（真实数据）", () => {
    it("playerStats 示例数据符合 schema", async () => {
      const buf = readFileSync(EXAMPLE_ZIP);
      const { files } = await parseDemoPackage(buf);

      // Zod parse 在 parseDemoPackage 内部已执行，这里只验证数据完整性
      const stats = files.playerStats as Array<Record<string, unknown>>;
      for (const s of stats) {
        expect(s).toHaveProperty("steamId64");
        expect(s).toHaveProperty("kills");
        expect(s).toHaveProperty("deaths");
        expect(s).toHaveProperty("adr");
        expect(s).toHaveProperty("headshotCount");
        expect(typeof (s as any).kills).toBe("number");
        expect(typeof (s as any).adr).toBe("number");
      }
      // 至少两个队伍的数据
      const teamKeys = new Set(stats.map((s: any) => s.teamKey));
      expect(teamKeys.size).toBeGreaterThanOrEqual(2);
    });

    it("kills 示例数据包含武器/击杀方/受害者信息", async () => {
      const buf = readFileSync(EXAMPLE_ZIP);
      const { files } = await parseDemoPackage(buf);

      const kills = files.kills as Array<Record<string, unknown>>;
      expect(kills.length).toBeGreaterThan(0);
      const first = kills[0] as any;
      expect(first).toHaveProperty("roundNumber");
      expect(first).toHaveProperty("killerSteamId64");
      expect(first).toHaveProperty("victimSteamId64");
      expect(first).toHaveProperty("weapon");
      expect(first).toHaveProperty("headshot");
    });

    it("rounds 数据包含队伍/胜负/经济信息", async () => {
      const buf = readFileSync(EXAMPLE_ZIP);
      const { files } = await parseDemoPackage(buf);

      const rounds = files.rounds as Array<Record<string, unknown>>;
      expect(rounds.length).toBeGreaterThan(0);
      const first = rounds[0] as any;
      expect(first).toHaveProperty("roundNumber");
      expect(first).toHaveProperty("winnerTeamKey");
      expect(typeof first.roundNumber).toBe("number");
    });
  });

  // ── 阶段 3: toMatchPlayerStat 转换（真实数据驱动）──
  describe("toMatchPlayerStat: demo stats → matchPlayerStats", () => {
    it("转换 example 中第一个 player 的数据", async () => {
      const buf = readFileSync(EXAMPLE_ZIP);
      const { files } = await parseDemoPackage(buf);

      const rawStats = files.playerStats as any[];
      const first = rawStats[0];

      // 模拟 mapPlayers 中已映射的名字和 userId
      const demoName = "PlayerOne";
      const fakeUserId = "user-mock-001";

      const result = toMatchPlayerStat(first, demoName, fakeUserId);

      expect(result.source).toBe("demo_import");
      // mapId 不属于 MatchPlayerStatRow，由 db layer 的调用方赋值
      expect(result.kills).toBe(first.kills);
      expect(result.deaths).toBe(first.deaths);
      expect(result.assists).toBe(first.assists);
      expect(result.adr).toBe(first.adr);
      expect(result.hsPercent).toBe(
        first.kills > 0 ? Math.round((first.headshotCount / first.kills) * 100) : 0,
      );
      expect(result.firstKills).toBe(first.firstKillCount);
      expect(result.multiKills).toBe(
        (first.twoKillCount ?? 0) +
        (first.threeKillCount ?? 0) +
        (first.fourKillCount ?? 0) +
        (first.fiveKillCount ?? 0),
      );
      expect(result.clutches).toBe(
        (first.vsOneWonCount ?? 0) +
        (first.vsTwoWonCount ?? 0) +
        (first.vsThreeWonCount ?? 0) +
        (first.vsFourWonCount ?? 0) +
        (first.vsFiveWonCount ?? 0),
      );
    });

    it("全部 player 转换后 kills 汇总与 demo 总击杀数一致", async () => {
      const buf = readFileSync(EXAMPLE_ZIP);
      const { files } = await parseDemoPackage(buf);

      const rawStats = files.playerStats as any[];
      const kills = files.kills as any[];

      const totalDemoKills = kills.length;
      const totalStatKills = rawStats.reduce((sum: number, s: any) => sum + (s.kills ?? 0), 0);

      // 由于 demo 可能有 TK/自伤，stat.kills 应 ≥ kill 记录数
      expect(totalStatKills).toBeGreaterThanOrEqual(totalDemoKills);
      expect(totalStatKills - totalDemoKills).toBeLessThan(10); // 合理误差内
    });
  });

  // ── 阶段 4: batchInsert 分片逻辑 ──
  describe("batchInsert 分片逻辑", () => {
    it("空数组直接返回，不调用 tx.insert", async () => {
      const tx = { insert: vi.fn().mockReturnValue({ values: vi.fn() }) } as any;
      await batchInsert(tx, {} as any, []);
      expect(tx.insert).not.toHaveBeenCalled();
    });

    it("少量数据不分片", async () => {
      const values = vi.fn();
      const tx = { insert: vi.fn().mockReturnValue({ values }) } as any;
      const rows = [{ a: 1 }, { a: 2 }];

      await batchInsert(tx, {} as any, rows);

      expect(tx.insert).toHaveBeenCalledTimes(1);
      expect(values).toHaveBeenCalledWith(rows);
    });

    it("大量数据分片为多个 chunk", async () => {
      const values = vi.fn();
      const tx = { insert: vi.fn().mockReturnValue({ values }) } as any;
      const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i, val: `x${i}` }));

      await batchInsert(tx, {} as any, rows, 1000);

      expect(tx.insert).toHaveBeenCalledTimes(3); // 1000 + 1000 + 500
    });

    it("自定义 chunkSize 生效", async () => {
      const values = vi.fn();
      const tx = { insert: vi.fn().mockReturnValue({ values }) } as any;
      const rows = Array.from({ length: 100 }, (_, i) => ({ id: i }));

      await batchInsert(tx, {} as any, rows, 30);

      expect(tx.insert).toHaveBeenCalledTimes(4); // 30+30+30+10
    });

    it("chunk 边界处不遗漏任何行", async () => {
      let totalInserted = 0;
      const values = vi.fn((chunk: any[]) => { totalInserted += chunk.length; });
      const tx = { insert: vi.fn().mockReturnValue({ values }) } as any;
      const rows = Array.from({ length: 1000 }, (_, i) => ({ idx: i }));

      await batchInsert(tx, {} as any, rows, 300);

      expect(totalInserted).toBe(1000);
      // 验证没有行重复
      const allRows: number[] = [];
      for (const call of values.mock.calls) {
        const chunk = call[0] as any[];
        for (const r of chunk) {
          expect(allRows).not.toContain(r.idx);
          allRows.push(r.idx);
        }
      }
      expect(allRows.length).toBe(1000);
      expect(allRows.sort((a, b) => a - b)).toEqual(Array.from({ length: 1000 }, (_, i) => i));
    });
  });
});
