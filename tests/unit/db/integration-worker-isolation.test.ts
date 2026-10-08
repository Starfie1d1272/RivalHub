import { afterEach, expect, it, vi } from "vitest";

const urls = [1, 2, 3].map(slot => `postgresql://postgres:postgres@127.0.0.1:5432/worker_${slot}`);
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
async function loadSetup(poolId: string, workerId: string) {
  vi.stubEnv("RIVALHUB_INTEGRATION_DATABASES", JSON.stringify(urls));
  vi.stubEnv("VITEST_POOL_ID", poolId);
  vi.stubEnv("VITEST_WORKER_ID", workerId);
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("RIVALHUB_LOCAL_DATABASE_URL", "");
  vi.stubEnv("RIVALHUB_DB_TARGET", "");
  vi.resetModules();
  await import("../../integration/setup");
  return process.env.DATABASE_URL;
}
it("assigns distinct concurrent pool slots even when file worker IDs collide modulo pool size", async () => {
  const selected = [];
  for (const [pool, worker] of [[1, 1], [2, 4], [3, 7]]) {
    selected.push(await loadSetup(String(pool), String(worker)));
  }
  expect(selected).toEqual(urls);
  expect(await loadSetup("1", "100")).toBe(urls[0]);
});
it.each(["0", "4", "NaN"])("rejects unmapped pool slot %s instead of sharing a database", async poolId => {
  await expect(loadSetup(poolId, "1")).rejects.toThrow("拒绝共享 fallback");
});
