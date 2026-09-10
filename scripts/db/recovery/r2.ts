import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { redactText } from "../../../src/lib/observability/redact";
import type { BackupClass, R2ObjectEnvironment } from "./environment";
import { sha256File } from "./manifest";

const MAX_PROVIDER_DIAGNOSTIC_LENGTH = 1_200;
const CREDENTIAL_ENV_NAMES = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_SECURITY_TOKEN",
] as const;

export interface R2Head {
  bytes: number;
  sha256: string;
}

export interface RecoveryR2Keys {
  artifact: string;
  manifest: string;
  completion: string;
}

export interface RecoveryR2Client {
  readonly endpoint: string;
  readonly bucket: string;
  put(path: string, key: string, options: { contentType: string; metadata: Record<string, string> }): void;
  head(key: string): R2Head;
  download(key: string, path: string): void;
}

export function createR2Client(config: R2ObjectEnvironment): RecoveryR2Client {
  const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    AWS_ACCESS_KEY_ID: config.accessKeyId,
    AWS_SECRET_ACCESS_KEY: config.secretAccessKey,
    AWS_REGION: "auto",
    AWS_EC2_METADATA_DISABLED: "true",
  };
  delete environment.AWS_PROFILE;
  delete environment.AWS_SESSION_TOKEN;
  delete environment.AWS_SECURITY_TOKEN;

  return {
    endpoint,
    bucket: config.bucket,
    put(path, key, options) {
      runAws([
        "s3api",
        "put-object",
        "--endpoint-url",
        endpoint,
        "--bucket",
        config.bucket,
        "--key",
        key,
        "--body",
        resolve(path),
        "--if-none-match",
        "*",
        "--content-type",
        options.contentType,
        "--metadata",
        serializeR2Metadata(options.metadata),
      ], environment);
    },
    head(key) {
      return readHead(key);
    },
    download(key, path) {
      runAws([
        "s3api",
        "get-object",
        "--endpoint-url",
        endpoint,
        "--bucket",
        config.bucket,
        "--key",
        key,
        resolve(path),
      ], environment);
    },
  };

  function readHead(key: string): R2Head {
    const raw = runAws([
      "s3api",
      "head-object",
      "--endpoint-url",
      endpoint,
      "--bucket",
      config.bucket,
      "--key",
      key,
      "--output",
      "json",
    ], environment);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("R2 head-object response invalid; recovery artifact is not trusted. ");
    }
    const record = value as { ContentLength?: unknown; Metadata?: { sha256?: unknown } };
    if (typeof record.ContentLength !== "number" || typeof record.Metadata?.sha256 !== "string") {
      throw new Error("R2 object is missing checksum metadata; recovery artifact is not trusted. ");
    }
    return { bytes: record.ContentLength, sha256: record.Metadata.sha256 };
  }
}

export function buildRecoveryR2Keys(
  backupClass: BackupClass,
  runId: string,
  createdAt: string,
): RecoveryR2Keys {
  const date = createdAt.slice(0, 10);
  const prefix = `production/${backupClass}/${date}/${runId}`;
  return {
    artifact: `${prefix}.tar.gz.age`,
    manifest: `${prefix}.manifest.json`,
    completion: `${prefix}.complete.json`,
  };
}

export function assertR2HeadReadback(
  head: R2Head,
  expected: { bytes: number; sha256: string },
): void {
  if (head.bytes !== expected.bytes || head.sha256 !== expected.sha256) {
    throw new Error("R2 object read-back checksum/size mismatch; canonical backup aborted. ");
  }
}

export function assertR2ContentReadback(
  path: string,
  expected: { bytes: number; sha256: string },
): void {
  assertR2HeadReadback(
    { bytes: statSync(path).size, sha256: sha256File(path) },
    expected,
  );
}

export function serializeR2Metadata(metadata: Record<string, string>): string {
  return Object.entries(metadata).map(([name, value]) => `${name}=${value}`).join(",");
}

function runAws(args: readonly string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync("aws", args, {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0 || result.signal) {
    const diagnostic = sanitizeProviderDiagnostic(result.stderr, env);
    const status = result.signal ? `signal ${result.signal}` : `exit ${result.status ?? "unknown"}`;
    throw new Error(
      `R2 S3 operation failed (${status}); canonical recovery artifact is not complete.${diagnostic ? ` Diagnostic: ${diagnostic}` : ""}`,
    );
  }
  return result.stdout.trim();
}

function sanitizeProviderDiagnostic(
  stderr: string | Buffer | undefined,
  env: NodeJS.ProcessEnv,
): string {
  let safe = typeof stderr === "string" ? stderr : stderr?.toString("utf8") ?? "";
  for (const name of CREDENTIAL_ENV_NAMES) {
    const value = env[name]?.trim();
    if (value) safe = safe.split(value).join("[REDACTED]");
  }
  safe = safe
    .replace(/((?:AWS_)?(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|SECURITY_TOKEN)\s*[=:]\s*)\S+/gi, "$1[REDACTED]")
    .replace(/((?:--)?(?:access-key-id|secret-access-key|session-token|security-token)\s+)\S+/gi, "$1[REDACTED]");
  return redactText(safe, MAX_PROVIDER_DIAGNOSTIC_LENGTH);
}
