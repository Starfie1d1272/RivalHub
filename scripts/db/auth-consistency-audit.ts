import { sql } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { db } from "../../src/db/client-runtime";
import { auditLogs } from "../../src/db/schema";
import { assertLocalDatabaseUrl, assertLocalHttpUrl } from "./local-environment";
import {
  AUTH_CONSISTENCY_GRACE_WINDOW_MS,
  buildAuthConsistencyRepairPlan,
  buildAuthConsistencyReport,
  summarizeAuthConsistencyReport,
  type AuthConsistencyAuthUser,
  type AuthConsistencyCanonicalUser,
  type AuthConsistencyIdentity,
  type AuthConsistencyRecord,
  type AuthConsistencyRepairPlan,
} from "../../src/lib/identity/auth-consistency";
import { resolveOrCreateCanonicalUserInTx } from "../../src/lib/identity/canonical";

const AUTH_PAGE_SIZE = 1000;
const MAX_AUTH_PAGES = 10_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AuditOptions {
  repairAuthUserId?: string;
  apply: boolean;
  graceWindowMs: number;
  graceWindowHours: number;
  help: boolean;
}

interface DatabaseSnapshot {
  canonicalUsers: AuthConsistencyCanonicalUser[];
  identities: AuthConsistencyIdentity[];
}

interface FormattedRepairPlan {
  authUserId: string;
  classification: AuthConsistencyRepairPlan["classification"];
  action: AuthConsistencyRepairPlan["action"];
  canonicalUserId: string | null;
  verifiedAt: string | null;
  executable: boolean;
  blockerCode: string | null;
  conflictCode: string | null;
  applied?: { canonicalUserId: string };
}

interface AuditOutput {
  mode: "audit" | "repair_dry_run" | "repair_apply";
  target: string;
  generatedAt: string;
  graceWindowHours: number;
  summary: ReturnType<typeof summarizeAuthConsistencyReport>;
  records: ReturnType<typeof formatRecord>[];
  repair?: FormattedRepairPlan;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) return;
  const target = requireTarget();
  const generatedAt = new Date();
  const authUsers = await listAuthUsers();
  const snapshot = await readDatabaseSnapshot();
  const records = buildAuthConsistencyReport(snapshotToInput(authUsers, snapshot), {
    now: generatedAt,
    graceWindowMs: options.graceWindowMs,
  });

  const selectedRecords = options.repairAuthUserId
    ? records.filter((record) => record.authUserId === options.repairAuthUserId)
    : records;
  const output: AuditOutput = {
    mode: options.repairAuthUserId ? (options.apply ? "repair_apply" : "repair_dry_run") : "audit",
    target,
    generatedAt: generatedAt.toISOString(),
    graceWindowHours: options.graceWindowHours,
    summary: summarizeAuthConsistencyReport(selectedRecords),
    records: selectedRecords.map(formatRecord),
  };

  if (options.repairAuthUserId) {
    const authUser = authUsers.find((user) => user.id === options.repairAuthUserId);
    const record = records.find((entry) => entry.authUserId === options.repairAuthUserId);
    const plan = buildAuthConsistencyRepairPlan(record, authUser);
    const repair = formatRepairPlan(plan);
    if (options.apply) {
      requireWriteAuthorization(target);
      if (!plan.executable || !authUser?.email || !plan.verifiedAt) {
        throw new Error(`Auth consistency repair 被拒绝：${plan.blockerCode ?? plan.conflictCode ?? "repair_not_allowed"}。`);
      }
      const applied = await applyRepair(authUser, plan);
      repair.applied = applied;
    }
    output.repair = repair;
  }

  console.log(JSON.stringify(output, null, 2));
}

function parseOptions(args: readonly string[]): AuditOptions {
  let repairAuthUserId: string | undefined;
  let apply = false;
  let graceWindowHours = 24;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--repair-auth") {
      const value = args[++index];
      if (!value || !UUID_PATTERN.test(value)) throw new Error("--repair-auth 必须是有效的 Auth UUID。");
      repairAuthUserId = value;
      continue;
    }
    if (arg === "--grace-hours") {
      const value = Number(args[++index]);
      if (!Number.isFinite(value) || value < 0 || value > 24 * 365) {
        throw new Error("--grace-hours 必须是 0 到 8760 之间的有限小时数。");
      }
      graceWindowHours = value;
      continue;
    }
    if (arg === "--help") {
      console.log("用法：pnpm db:auth-consistency-audit [--grace-hours N] [--repair-auth AUTH_UUID [--apply]]");
      return { apply: false, graceWindowMs: AUTH_CONSISTENCY_GRACE_WINDOW_MS, graceWindowHours: 24, help: true };
    }
    throw new Error(`未知参数 ${arg}。使用 --help 查看用法。`);
  }

  if (apply && !repairAuthUserId) throw new Error("--apply 只能与 --repair-auth AUTH_UUID 一起使用。");
  return {
    repairAuthUserId,
    apply,
    graceWindowHours,
    graceWindowMs: graceWindowHours * 60 * 60 * 1000,
    help: false,
  };
}

function requireTarget(): string {
  const target = process.env.RIVALHUB_DB_TARGET?.trim();
  if (!target) throw new Error("必须显式设置 RIVALHUB_DB_TARGET；请通过 local 或 protected production wrapper 运行 audit。");
  if (target !== "local" && target !== "production") {
    throw new Error("Auth consistency audit 只接受 local，或通过 protected production wrapper 使用 production。");
  }
  if (target === "production" && process.env.RIVALHUB_AUTH_CONSISTENCY_PROTECTED_TARGET !== "production") {
    throw new Error("production Auth consistency audit 必须通过 protected production wrapper 运行。");
  }
  if (target === "local") {
    assertLocalDatabaseUrl(process.env.DATABASE_URL, "DATABASE_URL");
    assertLocalHttpUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  }
  return target;
}

function requireWriteAuthorization(target: string): void {
  if (process.env.RIVALHUB_ALLOW_REMOTE_DB_WRITE !== target) {
    throw new Error(`Auth consistency repair 未授权；必须显式设置 RIVALHUB_ALLOW_REMOTE_DB_WRITE=${target}。`);
  }
}

async function listAuthUsers(): Promise<AuthConsistencyAuthUser[]> {
  const apiUrl = requiredSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = required(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const users: AuthConsistencyAuthUser[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_AUTH_PAGES; page += 1) {
    const result = await client.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE });
    if (result.error) throw new Error("读取 Supabase Auth users 失败；未生成 audit 结果。");
    const pageUsers = result.data.users;
    for (const user of pageUsers) {
      if (seen.has(user.id)) throw new Error("Supabase Auth listUsers 返回重复 user id，拒绝生成不完整 audit。");
      seen.add(user.id);
      users.push({
        id: user.id,
        email: user.email ?? null,
        createdAt: requiredDate(user.created_at, `Auth user ${user.id} created_at`),
        confirmedAt: optionalDate(user.email_confirmed_at ?? user.confirmed_at, `Auth user ${user.id} confirmed_at`),
        lastSignInAt: optionalDate(user.last_sign_in_at, `Auth user ${user.id} last_sign_in_at`),
      });
    }
    if (pageUsers.length < AUTH_PAGE_SIZE) return users;
  }

  throw new Error(`Supabase Auth users 超过安全分页上限 ${MAX_AUTH_PAGES * AUTH_PAGE_SIZE}，拒绝生成不完整 audit。`);
}

async function readDatabaseSnapshot(): Promise<DatabaseSnapshot> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const state = await tx.execute(sql`SHOW transaction_read_only`);
    if ((state.rows[0] as { transaction_read_only?: string } | undefined)?.transaction_read_only !== "on") {
      throw new Error("PostgreSQL 未确认 read-only transaction，拒绝执行 Auth consistency audit。");
    }

    const canonicalRows = await tx.execute(sql`
      SELECT id::text AS id, auth_id::text AS "authId", email, created_at AS "createdAt"
      FROM users
      WHERE status = 'active'
      ORDER BY id
    `);
    const identityRows = await tx.execute(sql`
      SELECT
        id::text AS id,
        user_id::text AS "userId",
        kind::text AS kind,
        provider,
        provider_subject AS "providerSubject",
        normalized_value AS "normalizedValue",
        verified_at AS "verifiedAt",
        is_primary AS "isPrimary"
      FROM user_identities
      WHERE status = 'active'
      ORDER BY id
    `);

    return {
      canonicalUsers: canonicalRows.rows.map((row) => ({
        id: requiredString(row.id, "users.id"),
        authId: optionalString(row.authId),
        email: requiredString(row.email, "users.email"),
        createdAt: requiredDate(row.createdAt, "users.created_at"),
      })),
      identities: identityRows.rows.map((row) => ({
        id: requiredString(row.id, "user_identities.id"),
        userId: requiredString(row.userId, "user_identities.user_id"),
        kind: requiredString(row.kind, "user_identities.kind"),
        provider: requiredString(row.provider, "user_identities.provider"),
        providerSubject: requiredString(row.providerSubject, "user_identities.provider_subject"),
        normalizedValue: optionalString(row.normalizedValue),
        verifiedAt: optionalDate(row.verifiedAt, "user_identities.verified_at"),
        isPrimary: row.isPrimary === true,
      })),
    };
  });
}

function snapshotToInput(authUsers: readonly AuthConsistencyAuthUser[], snapshot: DatabaseSnapshot) {
  return {
    authUsers,
    canonicalUsers: snapshot.canonicalUsers,
    identities: snapshot.identities,
  };
}

async function applyRepair(
  authUser: AuthConsistencyAuthUser,
  plan: AuthConsistencyRepairPlan,
): Promise<{ canonicalUserId: string }> {
  if (!authUser.email || !plan.verifiedAt || !plan.action) throw new Error("Auth consistency repair 缺少受信任的 email、confirmation 或 action。");
  const email = authUser.email;
  const verifiedAt = plan.verifiedAt;
  return db.transaction(async (tx) => {
    const canonicalUser = await resolveOrCreateCanonicalUserInTx(tx, {
      authId: authUser.id,
      email,
      verifiedAt,
      source: "admin_migration",
      allowCreate: true,
    });
    if (plan.canonicalUserId && canonicalUser.id !== plan.canonicalUserId) {
      throw new Error("Auth consistency repair 的 canonical owner 在执行期间发生变化，事务已拒绝提交。");
    }
    await tx.insert(auditLogs).values({
      seasonId: null,
      action: "user_identity.auth_consistency_repair",
      actorId: "system:auth-consistency-audit",
      targetId: canonicalUser.id,
      targetType: "user",
      meta: {
        authUserId: authUser.id,
        repairCode: plan.action,
        classification: plan.classification,
        provenance: "admin_migration",
      },
    });
    return { canonicalUserId: canonicalUser.id };
  });
}

function formatRecord(record: AuthConsistencyRecord) {
  return {
    classification: record.classification,
    severity: record.severity,
    authUserId: record.authUserId,
    canonicalUserId: record.canonicalUserId,
    createdAt: formatDate(record.createdAt),
    confirmedAt: formatDate(record.confirmedAt),
    lastSignInAt: formatDate(record.lastSignInAt),
    identityOwnership: record.identityOwnership,
    healability: record.healability,
    repairCode: record.repairCode,
    blockerCode: record.blockerCode,
    conflictCode: record.conflictCode,
  };
}

function formatRepairPlan(plan: AuthConsistencyRepairPlan): FormattedRepairPlan {
  return {
    authUserId: plan.authUserId,
    classification: plan.classification,
    action: plan.action,
    canonicalUserId: plan.canonicalUserId,
    verifiedAt: formatDate(plan.verifiedAt),
    executable: plan.executable,
    blockerCode: plan.blockerCode,
    conflictCode: plan.conflictCode,
  };
}

function requiredSupabaseUrl(value: string | undefined): string {
  if (!value?.trim()) throw new Error("NEXT_PUBLIC_SUPABASE_URL 未设置；未生成 audit 结果。");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL 格式无效；未生成 audit 结果。");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL 必须是无 credential/query 的 HTTP(S) origin。");
  }
  return url.origin;
}

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} 未设置；未生成 audit 结果。`);
  return value.trim();
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 缺失；拒绝生成不完整 audit。`);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function requiredDate(value: unknown, label: string): Date {
  const date = optionalDate(value, label);
  if (!date) throw new Error(`${label} 不是有效 timestamp；拒绝生成不完整 audit。`);
  return date;
}

function optionalDate(value: unknown, label: string): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} 不是有效 timestamp；拒绝生成不完整 audit。`);
  return date;
}

function formatDate(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
