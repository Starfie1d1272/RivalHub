import { assertCloudflareAccountId, assertR2BucketName } from "./environment";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";
const DAYS_30_SECONDS = 30 * 24 * 60 * 60;

export const R2_LIFECYCLE_RULES = [
  {
    id: "rivalhub-production-30d",
    enabled: true,
    conditions: { prefix: "production/" },
    deleteObjectsTransition: { condition: { type: "Age", maxAge: DAYS_30_SECONDS } },
  },
] as const;

export const R2_LOCK_RULES = [
  {
    id: "rivalhub-production-lock",
    enabled: true,
    prefix: "production/",
    condition: { type: "Age", maxAgeSeconds: DAYS_30_SECONDS },
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
  assertNoConflictingLockRules(existingLocks);

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
  assertNoConflictingLockRules(lockRules);

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

  // 验证 canonical bucket 是 private
  await verifyR2NoManagedPublicAccess(config);
  await verifyR2NoCustomDomains(config);

  console.log("R2 retention contract verified: 30d lifecycle/lock rules and private bucket access are active.");
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
  const result = await cloudflareRequest<unknown>(config, "domains/managed", "GET");
  const managed = assertManagedDomainResult(result);
  if (managed.enabled) {
    throw new Error("R2 canonical bucket 启用了 managed r2.dev public access；recovery bucket 必须是完全私有的。");
  }
}

export async function verifyR2NoCustomDomains(config: R2Config): Promise<void> {
  const result = await cloudflareRequest<unknown>(config, "domains/custom", "GET");
  const domains = assertCustomDomainResult(result);
  const activeDomains = domains.filter((domain) => domain.enabled);
  if (activeDomains.length > 0) {
    throw new Error("R2 canonical bucket 存在已启用的 custom domain；recovery bucket 必须是完全私有的。");
  }
}

export function assertNoConflictingLifecycleRules(
  existingRules: readonly Record<string, unknown>[],
): void {
  const expectedIds = new Set<string>(R2_LIFECYCLE_RULES.map((r) => r.id));
  for (const rule of existingRules) {
    if (expectedIds.has(ruleId(rule))) continue;
    if (rule.enabled === false) continue;

    // Aborting incomplete multipart uploads is Cloudflare default behavior,
    // not completed-object deletion, and must not be treated as a retention conflict.
    if (!rule.deleteObjectsTransition) continue;

    const prefix = lifecyclePrefix(rule);
    if (prefixesOverlap(prefix, "production/")) {
      throw new Error(
        `R2 lifecycle 存在未知或冲突的 destructive rule ${ruleId(rule)} (prefix=${JSON.stringify(prefix)})，可能缩短 production/ retention；拒绝操作。`,
      );
    }
  }
}

export function assertNoConflictingLockRules(
  existingRules: readonly Record<string, unknown>[],
): void {
  const expectedIds = new Set<string>(R2_LOCK_RULES.map((rule) => rule.id));
  for (const rule of existingRules) {
    if (expectedIds.has(ruleId(rule)) || rule.enabled === false) continue;
    if (prefixesOverlap(lockPrefix(rule), "production/")) {
      throw new Error(
        `R2 bucket lock 存在未知或冲突的 production overlapping rule ${ruleId(rule)}；拒绝操作。`,
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
  const response = await cloudflareRequest<unknown>(config, kind, "GET");
  if (!isRecord(response) || !Array.isArray(response.rules) || !response.rules.every(isRecord)) {
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
  if (method === "GET" && !isRecord(payload.result)) {
    throw new Error(`Cloudflare R2 ${subpath} GET result 格式无效；拒绝信任 provider response。 `);
  }
  return payload.result as T;
}

function mergeRules(
  existing: readonly Record<string, unknown>[],
  desired: readonly Record<string, unknown>[],
  kind: RuleKind,
): Record<string, unknown>[] {
  const desiredById = new Map(desired.map((rule) => [ruleId(rule), rule]));
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

function assertManagedDomainResult(value: unknown): { bucketId: string; domain: string; enabled: boolean } {
  if (!isRecord(value) || typeof value.bucketId !== "string" || typeof value.domain !== "string" || typeof value.enabled !== "boolean") {
    throw new Error("R2 managed domain response 格式无效；拒绝信任 provider state。 ");
  }
  return value as { bucketId: string; domain: string; enabled: boolean };
}

function assertCustomDomainResult(value: unknown): Array<{ domain: string; enabled: boolean }> {
  if (!isRecord(value) || !Array.isArray(value.domains)) {
    throw new Error("R2 custom domain response 格式无效；拒绝信任 provider state。 ");
  }
  if (!value.domains.every(isRecord)) {
    throw new Error("R2 custom domain response contains an invalid domain record; refuse provider state. ");
  }
  return value.domains.map((domain) => {
    if (typeof domain.domain !== "string" || typeof domain.enabled !== "boolean") {
      throw new Error("R2 custom domain response contains an invalid domain identity or enabled flag; refuse provider state. ");
    }
    return domain as { domain: string; enabled: boolean };
  });
}

function lifecyclePrefix(rule: Record<string, unknown>): string {
  const conditions = rule.conditions;
  if (!isRecord(conditions) || typeof conditions.prefix !== "string") {
    return "";
  }
  return conditions.prefix;
}

function lockPrefix(rule: Record<string, unknown>): string {
  return typeof rule.prefix === "string" ? rule.prefix : "";
}

function prefixesOverlap(left: string, right: string): boolean {
  return left === right
    || left.startsWith(right)
    || right.startsWith(left);
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
