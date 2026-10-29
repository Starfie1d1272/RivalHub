import type { Pool } from "pg";

/** Hosted tenants must initialize their managed table before migration 0103 is recorded. */
export async function assertHostedRealtimeTable(pool: Pick<Pool, "query">): Promise<void> {
  const result = await pool.query<{ table_name: string | null }>("SELECT to_regclass('realtime.messages')::text AS table_name");
  if (!result.rows[0]?.table_name) throw new Error("Hosted Realtime 尚未初始化 realtime.messages；拒绝迁移。 ");
}

/** Do not accept an absent, broadened, or writable viewer policy as a completed migration. */
export async function verifyHostedRealtimePolicy(pool: Pick<Pool, "query">): Promise<void> {
  await assertHostedRealtimeTable(pool);
  const result = await pool.query<{ policyname: string; cmd: string; permissive: string; roles: string[]; qual: string | null }>(
    "SELECT policyname, cmd, permissive, roles::text[] AS roles, qual FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND (roles && ARRAY['public','authenticated']::name[]) ORDER BY policyname",
  );
  const viewer = result.rows.filter(row => row.policyname === "rivalhub_match_live_receive");
  if (viewer.length !== 1 || viewer[0].cmd !== "SELECT" || viewer[0].permissive !== "PERMISSIVE" || viewer[0].roles.length !== 1 || viewer[0].roles[0] !== "authenticated") throw new Error("Hosted Realtime viewer policy 缺失或权限不正确。 ");
  const qual = (viewer[0].qual ?? "").replace(/\s+/g, " ");
  const expected = `((extension = 'broadcast'::text) AND (( SELECT (auth.jwt() ->> 'scope'::text)) = 'live-viewer'::text) AND (( SELECT (auth.jwt() ->> 'matchId'::text)) = "substring"(( SELECT realtime.topic() AS topic), '^match-live:([0-9a-f-]{36})$'::text)))`;
  if (qual !== expected) throw new Error("Hosted Realtime viewer policy 条件不匹配。 ");
  if (result.rows.some(row => row.policyname !== "rivalhub_match_live_receive")) throw new Error("Hosted Realtime 存在额外 viewer 读写策略。 ");
}
