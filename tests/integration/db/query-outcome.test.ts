import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { createLocalPool } from "./harness/database";

it("preserves a committed write after response loss, SQL constraints, and transaction rollback", async () => {
  const observer = createLocalPool();
  const table = `query_outcome_${randomUUID().replaceAll("-", "")}`;
  const lostResponse = new Error("Connection terminated unexpectedly");
  const original = Pool.prototype.query;
  let dispatched = 0;
  let runtimePool: Pool | undefined;
  await observer.query(`CREATE TABLE ${table} (id integer PRIMARY KEY)`);
  // Execute against PostgreSQL, then discard the committed response at the driver boundary.
  const spy = vi.spyOn(Pool.prototype, "query").mockImplementation(function (this: Pool, ...args: unknown[]) {
    const result = Reflect.apply(original, this, args);
    if (typeof args[0] === "string" && args[0].includes("/* lose-response */")) {
      dispatched += 1;
      return Promise.resolve(result).then(() => { throw lostResponse; });
    }
    return result;
  } as Pool["query"]);
  try {
    const { db } = await import("@/db/client-runtime");
    const currentPool = () => (db as unknown as { $client: Pool }).$client;
    runtimePool = currentPool();
    const oldPool = runtimePool;
    await expect(oldPool.query(`INSERT INTO ${table} VALUES (1) /* lose-response */`)).rejects.toBe(lostResponse);
    expect(dispatched).toBe(1);
    expect((await observer.query(`SELECT * FROM ${table}`)).rows).toEqual([{ id: 1 }]);
    await vi.waitFor(() => expect(currentPool()).not.toBe(oldPool));
    runtimePool = currentPool();
    await expect(runtimePool.query(`INSERT INTO ${table} VALUES (1)`)).rejects.toMatchObject({ code: "23505" });
    await expect(drizzle(runtimePool).transaction(async (tx) => {
      await tx.execute(sql.raw(`INSERT INTO ${table} VALUES (2)`));
      throw new Error("rollback fixture");
    })).rejects.toThrow("rollback fixture");
    expect((await observer.query(`SELECT * FROM ${table}`)).rows).toEqual([{ id: 1 }]);
  } finally {
    spy.mockRestore();
    await runtimePool?.end();
    await observer.query(`DROP TABLE ${table}`);
    await observer.end();
  }
});
