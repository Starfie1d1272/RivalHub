import { sql } from "drizzle-orm";
import { db } from "../../src/db/client-runtime";
import { buildUserMergePreflight } from "../../src/lib/identity/merge";

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`必须提供有效的 --${name} UUID。`);
  }
  return value;
}

try {
  const canonicalUserId = argument("canonical");
  const mergedUserId = argument("merged");
  const plan = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const state = await tx.execute(sql`SHOW transaction_read_only`);
    if ((state.rows[0] as { transaction_read_only?: string } | undefined)?.transaction_read_only !== "on") {
      throw new Error("PostgreSQL 未确认 read-only transaction，拒绝执行 preflight。");
    }
    return buildUserMergePreflight(tx, { canonicalUserId, mergedUserId });
  });
  console.log(JSON.stringify({
    mode: "read-only",
    canonicalUserId: plan.canonicalUserId,
    mergedUserId: plan.mergedUserId,
    fingerprint: plan.fingerprint,
    executable: plan.executable,
    summary: plan.summary,
    items: plan.items.map(({ category, domain, count, status, detail }) => ({ category, domain, count, status, detail })),
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
