import { asc, eq, sql } from "drizzle-orm";
import { db } from "../../src/db/client-runtime";
import { auditLogs, userIdentities, users } from "../../src/db/schema";
import { createServiceClient } from "../../src/lib/auth/supabase-server";
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
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY 未设置；未生成 audit 结果。");
  }
  return target;
}

function requireWriteAuthorization(target: string): void {
  if (target === "local") return;
  if (process.env.RIVALHUB_ALLOW_REMOTE_DB_WRITE !== target) {
    throw new Error(`Auth consistency repair 未授权；必须显式设置 RIVALHUB_ALLOW_REMOTE_DB_WRITE=${target}。`);
  }
}

async function listAuthUsers(): Promise<AuthConsistencyAuthUser[]> {
  const client = createServiceClient();
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
        createdAt: requiredAuthDate(user.created_at, `Auth user ${user.id} created_at`),
        confirmedAt: optionalAuthDate(user.email_confirmed_at ?? user.confirmed_at, `Auth user ${user.id} confirmed_at`),
        lastSignInAt: optionalAuthDate(user.last_sign_in_at, `Auth user ${user.id} last_sign_in_at`),
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

    const canonicalRows = await tx.select({
      id: users.id,
      authId: users.authId,
      email: users.email,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.status, "active")).orderBy(asc(users.id));
    const identityRows = await tx.select({
      id: userIdentities.id,
      userId: userIdentities.userId,
      kind: userIdentities.kind,
      provider: userIdentities.provider,
      providerSubject: userIdentities.providerSubject,
      normalizedValue: userIdentities.normalizedValue,
      verifiedAt: userIdentities.verifiedAt,
      isPrimary: userIdentities.isPrimary,
    }).from(userIdentities).where(eq(userIdentities.status, "active")).orderBy(asc(userIdentities.id));

    return {
      canonicalUsers: canonicalRows,
      identities: identityRows,
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
      expectedCanonicalUserId: plan.canonicalUserId,
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

function requiredAuthDate(value: unknown, label: string): Date {
  const date = optionalAuthDate(value, label);
  if (!date) throw new Error(`${label} 不是有效 timestamp；拒绝生成不完整 audit。`);
  return date;
}

function optionalAuthDate(value: unknown, label: string): Date | null {
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
