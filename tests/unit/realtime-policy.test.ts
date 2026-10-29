import { describe, expect, it } from "vitest";
import { assertHostedRealtimeTable, verifyHostedRealtimePolicy } from "../../scripts/db/realtime-policy";

const qual = `((extension = 'broadcast'::text) AND (( SELECT (auth.jwt() ->> 'scope'::text)) = 'live-viewer'::text) AND (( SELECT (auth.jwt() ->> 'matchId'::text)) = "substring"(( SELECT realtime.topic() AS topic), '^match-live:([0-9a-f-]{36})$'::text)))`;
const policy = { policyname: "rivalhub_match_live_receive", cmd: "SELECT", permissive: "PERMISSIVE", roles: ["authenticated"], qual };
function pool(table: string | null, policies: unknown[]) {
  return { query: async (sql: string) => ({ rows: sql.includes("to_regclass") ? [{ table_name: table }] : policies }) } as never;
}
describe("hosted Realtime migration gates", () => {
  it("fails before migration when the managed table is missing", async () => {
    await expect(assertHostedRealtimeTable(pool(null, []))).rejects.toThrow(/尚未初始化/);
  });
  it("requires the exact receive-only viewer policy after migration", async () => {
    await expect(verifyHostedRealtimePolicy(pool("realtime.messages", [policy]))).resolves.toBeUndefined();
    await expect(verifyHostedRealtimePolicy(pool("realtime.messages", []))).rejects.toThrow(/缺失/);
    await expect(verifyHostedRealtimePolicy(pool("realtime.messages", [{ ...policy, qual: `${qual} OR true` }]))).rejects.toThrow(/不匹配/);
    await expect(verifyHostedRealtimePolicy(pool("realtime.messages", [policy, { policyname: "wide", cmd: "INSERT", roles: ["authenticated"], qual: null }]))).rejects.toThrow(/额外/);
  });
});
