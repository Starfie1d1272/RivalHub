import { describe, expect, it, vi } from "vitest";
import { importSnapshot } from "../../scripts/db/preview/refresh";
import type { MirrorSnapshot } from "../../scripts/db/preview/snapshot";

describe("preview snapshot import", () => {
  it("imports bounded batches in one transaction without dropping rows or columns", async () => {
    const rows = Array.from({ length: 501 }, (_, id) => ({ id, ...(id === 500 ? { extra: "值" } : {}) }));
    const snapshot = { tables: { example: rows } } as unknown as MirrorSnapshot;
    const query = vi.fn(async (sql: string, ...params: string[][]) => ({ rows: sql.startsWith("SELECT tablename") && params.length === 1 ? [{ tablename: "example" }] : [] }));
    await importSnapshot({ query } as never, snapshot);
    const inserts = query.mock.calls.filter(([sql]) => sql.startsWith("INSERT"));
    expect(inserts).toHaveLength(3);
    expect(inserts.every(([sql]) => sql.includes('"extra"'))).toBe(true);
    expect(inserts.flatMap(([, params]) => JSON.parse(params![0]))).toEqual(rows);
    expect(query.mock.calls[0][0]).toBe("BEGIN");
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("splits large multibyte rows by encoded size", async () => {
    const rows = Array.from({ length: 3 }, (_, id) => ({ id, text: "值".repeat(200_000) }));
    const query = vi.fn(async (sql: string, ...params: string[][]) => ({ rows: sql.startsWith("SELECT tablename") && params.length === 1 ? [{ tablename: "example" }] : [] }));
    await importSnapshot({ query } as never, { tables: { example: rows } } as unknown as MirrorSnapshot);
    const inserts = query.mock.calls.filter(([sql]) => sql.startsWith("INSERT"));
    expect(inserts).toHaveLength(3);
    expect(inserts.flatMap(([, params]) => JSON.parse(params![0]))).toEqual(rows);
  });
});
