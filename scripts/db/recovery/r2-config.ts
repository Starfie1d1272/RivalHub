import { assertCloudflareAccountId, assertR2BucketName } from "./environment";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const LOCK_7_DAYS_SECONDS = 7 * 24 * 60 * 60;
const HOURS_48_SECONDS = 48 * 60 * 60;
const DAYS_30_SECONDS = 30 * 24 * 60 * 60;

export const R2_LIFECYCLE_RULES = [
  lifecycleRule("rivalhub-hourly-48h", "production/hourly/", HOURS_48_SECONDS),
  lifecycleRule("rivalhub-daily-30d", "production/daily/", DAYS_30_SECONDS),
  lifecycleRule("rivalhub-pre-release-30d", "production/pre-release/", DAYS_30_SECONDS),
  lifecycleRule("rivalhub-manual-30d", "production/manual/", DAYS_30_SECONDS),
] as const;

export const R2_LOCK_RULES = [
  {
    id: "rivalhub-production-7d-lock",
    enabled: true,
    prefix: "production/",
    condition: { type: "Age", maxAgeSeconds: LOCK_7_DAYS_SECONDS },
  },
] as const;

export interface R2RetentionConfig {
  lifecycleRules: readonly unknown[];
  lockRules: readonly unknown[];
}

export async function applyR2RetentionConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<R2RetentionConfig> {
  const config = buildConfig(env);
  const existingLifecycle = await readRules(config, "lifecycle");
  assertNoConflictingLifecycleRules(existingLifecycle);
  const existingLocks = await readRules(config, "lock");

  // 1. 优先建立并验证 bucket lock
  const lockRules = mergeRules(existingLocks, R2_LOCK_RULES, "lock");
  await putRules(config, "lock", lockRules);
  await verifyLockRules(config);

  // 2. 再 apply lifecycle
  const lifecycleRules = mergeRules(existingLifecycle, R2_LIFECYCLE_RULES, "lifecycle");
  await putRules(config, "lifecycle", lifecycleRules);

  // 3. 最终完整 read-back
  await verifyR2RetentionConfig(env);
  return { lifecycleRules, lockRules };
}

export async function verifyR2RetentionConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<R2RetentionConfig> {
  const config = buildConfig(env);
  const lifecycleRules = await readRules(config, "lifecycle");
  assertNoConflictingLifecycleRules(lifecycleRules);
  const lockRules = await readRules(config, "lock");
  for (const expected of R2_LIFECYCLE_RULES) {
    const actual = lifecycleRules.find((rule) => ruleId(rule) === expected.id);
    if (!actual || !matchesLifecycleRule(actual, expected)) {
      throw new Error(`R2 lifecycle rule ${expected.id} 缺失或不匹配。 `);
    }
  }
  for (const expected of R2_LOCK_RULES) {
    const actual = lockRules.find((rule) => ruleId(rule) === expected.id);
    if (!actual || !matchesLockRule(actual, expected)) {
      throw new Error(`R2 bucket lock rule ${expected.id} 缺失或不匹配。 `);
    }
  }

  // 验证 canonical bucket 没有启用 managed r2.dev public access
  await verifyR2NoManagedPublicAccess(config);

  // 验证 canonical bucket 没有 enabled custom domain
  await verifyR2NoCustomDomains(config);

  console.log("R2 retention contract verified: lifecycle rules, 7-day bucket lock, and private bucket access are active.");
  return { lifecycleRules, lockRules };
}

async function verifyLockRules(config: R2Config): Promise<void> {
  const lockRules = await readRules(config, "lock");
  for (const expected of R2_LOCK_RULES) {
    const actual = lockRules.find((rule) => ruleId(rule) === expected.id);
    if (!actual || !matchesLockRule(actual, expected)) {
      throw new Error(`R2 bucket lock rule ${expected.id} apply 验证失败。 `);
    }
  }
}

export async function verifyR2NoManagedPublicAccess(config: R2Config): Promise<void> {
  const result = await cloudflareRequest<{ enabled?: boolean }>(config, "domains/managed", "GET");
  if (result.enabled === true) {
    throw new Error("R2 canonical bucket 启用了 managed r2.dev public access；recovery bucket 必须是完全私有的。");
  }
}

export async function verifyR2NoCustomDomains(config: R2Config): Promise<void> {
  const result = await cloudflareRequest<unknown>(config, "domains/custom", "GET");
  const domains = Array.isArray(result)
    ? result
    : isRecord(result) && Array.isArray(result.domains)
      ? result.domains
      : [];
  const activeDomains = domains.filter((d) => isRecord(d) && d.enabled !== false);
  if (activeDomains.length > 0) {
    throw new Error("R2 canonical bucket 存在已启用的 custom domain；recovery bucket 必须是完全私有的。");
  }
}

export function assertNoConflictingLifecycleRules(
  existingRules: readonly Record<string, unknown>[],
): void {
  const expectedIds = new Set(R2_LIFECYCLE_RULES.map((r) => r.id));
  for (const rule of existingRules) {
    if (expectedIds.has(ruleId(rule))) continue;
    if (rule.enabled === false) continue;

    const conditions = rule.conditions as { prefix?: unknown } | undefined;
    const prefix = typeof conditions?.prefix === "string"
      ? conditions.prefix
      : (typeof rule.prefix === "string" ? rule.prefix : "");

    const isDestructive = !!(
      rule.deleteObjectsTransition
      || rule.abortMultipartUploadsTransition
      || (rule as { expiration?: unknown }).expiration
    );
    if (!isDestructive) continue;

    // Check if prefix overlaps with "production/"
    const overlaps = prefix === ""
      || prefix === "production"
      || prefix.startsWith("production/")
      || "production/".startsWith(prefix);

    if (overlaps) {
      throw new Error(
        `R2 lifecycle 存在未知或冲突的 destructive rule ${ruleId(rule)} (prefix=${JSON.stringify(prefix)})，可能缩短 production/ retention；拒绝操作。`,
      );
    }
  }
}

interface R2Config {
  accountId: string;
  bucket: string;
  apiToken: string;
}

type RuleKind = "lifecycle" | "lock";

function buildConfig(env: Readonly<Record<string, string | undefined>>): R2Config {
  return {
    accountId: assertCloudflareAccountId(required(env.RIVALHUB_R2_ACCOUNT_ID, "RIVALHUB_R2_ACCOUNT_ID")),
    bucket: assertR2BucketName(required(env.RIVALHUB_R2_BUCKET, "RIVALHUB_R2_BUCKET")),
    apiToken: required(env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN"),
  };
}

async function readRules(config: R2Config, kind: RuleKind): Promise<Record<string, unknown>[]> {
  const response = await cloudflareRequest<{ rules?: unknown[] }>(config, kind, "GET");
  if (!Array.isArray(response.rules) || !response.rules.every(isRecord)) {
    throw new Error(`R2 ${kind} response rules 格式无效；拒绝覆盖 provider 配置。 `);
  }
  return response.rules;
}

async function putRules(
  config: R2Config,
  kind: RuleKind,
  rules: readonly unknown[],
): Promise<void> {
  await cloudflareRequest(config, kind, "PUT", { rules });
}

export async function cloudflareRequest<T>(
  config: R2Config,
  subpath: string,
  method: "GET" | "PUT",
  body?: unknown,
): Promise<T> {
  const path = `${CLOUDFLARE_API_BASE}/accounts/${config.accountId}/r2/buckets/${encodeURIComponent(config.bucket)}/${subpath}`;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Cloudflare R2 ${subpath} request failed. `);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Cloudflare R2 ${subpath} response invalid. `);
  }
  if (!response.ok || !isRecord(payload) || payload.success !== true) {
    throw new Error(`Cloudflare R2 ${subpath} request rejected (HTTP ${response.status}). `);
  }
  return (payload.result ?? {}) as T;
}

function mergeRules(
  existing: readonly Record<string, unknown>[],
  desired: readonly Record<string, unknown>[],
  kind: RuleKind,
): Record<string, unknown>[] {
  const desiredById = new Map(desired.map((rule) => [rule.id, rule]));
  for (const rule of existing) {
    const replacement = desiredById.get(ruleId(rule));
    if (replacement && !matchesRule(rule, replacement, kind)) {
      throw new Error(`R2 ${kind} rule ${ruleId(rule)} 已存在但配置不一致；拒绝覆盖。 `);
    }
  }
  const preserved = existing.filter((rule) => !desiredById.has(ruleId(rule)));
  return [...preserved, ...desired];
}

function matchesRule(actual: Record<string, unknown>, expected: Record<string, unknown>, kind: RuleKind): boolean {
  return kind === "lifecycle" ? matchesLifecycleRule(actual, expected) : matchesLockRule(actual, expected);
}

function matchesLifecycleRule(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  const expectedConditions = expected.conditions as { prefix: string };
  const actualConditions = actual.conditions as { prefix?: unknown } | undefined;
  const expectedTransition = expected.deleteObjectsTransition as { condition: { type: string; maxAge: number } };
  const actualTransition = actual.deleteObjectsTransition as { condition?: { type?: unknown; maxAge?: unknown } } | undefined;
  return actual.enabled === true
    && actualConditions?.prefix === expectedConditions.prefix
    && actualTransition?.condition?.type === expectedTransition.condition.type
    && actualTransition.condition.maxAge === expectedTransition.condition.maxAge;
}

function matchesLockRule(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  const expectedCondition = expected.condition as { type: string; maxAgeSeconds: number };
  const actualCondition = actual.condition as { type?: unknown; maxAgeSeconds?: unknown } | undefined;
  return actual.enabled === true
    && actual.prefix === expected.prefix
    && actualCondition?.type === expectedCondition.type
    && actualCondition.maxAgeSeconds === expectedCondition.maxAgeSeconds;
}

function lifecycleRule(id: string, prefix: string, maxAge: number): Record<string, unknown> {
  return {
    id,
    enabled: true,
    conditions: { prefix },
    deleteObjectsTransition: { condition: { type: "Age", maxAge } },
  };
}

function ruleId(rule: Record<string, unknown>): string {
  return typeof rule.id === "string" ? rule.id : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} 未设置；拒绝继续。 `);
  return value.trim();
}

if (process.argv[1]?.endsWith("r2-config.ts")) {
  const command = process.argv[2];
  const operation = command === "apply" ? applyR2RetentionConfig : command === "verify" ? verifyR2RetentionConfig : undefined;
  if (!operation) {
    console.error("用法：tsx scripts/db/recovery/r2-config.ts <apply|verify>");
    process.exitCode = 1;
  } else {
    operation().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "R2 retention operation failed.");
      process.exitCode = 1;
    });
  }
}
