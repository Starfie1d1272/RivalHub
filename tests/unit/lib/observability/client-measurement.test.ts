import type { PoolClient } from "pg";
import { beforeEach, expect, it, vi } from "vitest";

const observation = vi.hoisted(() => ({ enabled: true, record: vi.fn() }));
vi.mock("@/lib/observability/db-traffic", () => ({ dbTrafficSource: () => "unknown", queryShape: () => "q0000000000000000", dbTrafficEnabled: () => observation.enabled, recordDbTraffic: observation.record }));
import { createClientMeasurements, measureClient } from "@/db/client-measurement";

beforeEach(() => { observation.enabled = true; observation.record.mockReset(); });

it("measures UTF-8 rows, arrays, multiple results and empty results without changing return values", async () => {
  const values = [{ rows: [{ text: "中" }], rowCount: 1 }, { rows: [["é", 3]], rowCount: 1 }, { rows: [], rowCount: 0 }];
  const query = vi.fn().mockResolvedValue(values);
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const release = measureClient(client, createClientMeasurements());
  expect(await client.query("select 1")).toBe(values);
  expect(observation.record).toHaveBeenCalledWith("unknown", "q0000000000000000", 0, expect.any(Number), false, Buffer.byteLength('{"text":"中"}') + Buffer.byteLength('["é",3]'), undefined);
  query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
  await client.query("commit");
  expect(observation.record.mock.calls.at(-1)?.[5]).toBe(0);
  release();
});

it("preserves callback, failure, disabled, and serialization-gap semantics", async () => {
  const row = { rows: [{ value: BigInt(1) }], rowCount: 1 };
  const query = vi.fn((_text: string, cb?: (err: unknown, result: unknown) => unknown) => cb ? cb(null, row) : Promise.resolve(row));
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const release = measureClient(client, createClientMeasurements());
  const callback = vi.fn(() => "callback return");
  expect(client.query("insert returning id", callback)).toBe("callback return");
  expect(callback).toHaveBeenCalledWith(null, row);
  expect(observation.record.mock.calls[0][5]).toBeUndefined();
  expect(observation.record.mock.calls[0][6]).toBe("unsupported_value");
  observation.enabled = false;
  const toJSON = vi.fn(() => { throw Error("must not serialize"); });
  query.mockReturnValueOnce(Promise.resolve({ rows: [{ toJSON }] }));
  await client.query("select 1");
  expect(toJSON).not.toHaveBeenCalled();
  observation.enabled = true;
  const error = new Error("query failure");
  query.mockReturnValueOnce(Promise.reject(error));
  await expect(client.query("select 1")).rejects.toBe(error);
  expect(observation.record.mock.calls.at(-1)?.[5]).toBeUndefined();
  expect(observation.record.mock.calls.at(-1)?.[6]).toBe("error");
  release();
});
