import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  assertRecoveryFetchEnvironment,
  assertR2BucketName,
  type R2ObjectEnvironment,
} from "./environment";
import {
  assertRecoveryCompletionMarker,
  assertRecoverySidecar,
  type RecoveryCompletionMarker,
  type RecoverySidecar,
} from "./manifest";
import {
  assertR2ContentReadback,
  createR2Client,
  type RecoveryR2Client,
} from "./r2";

interface FetchArguments {
  completionKey: string;
  outputDirectory: string;
}

interface RecoveryObjectIdentity {
  backupClass: "daily" | "pre-release" | "manual";
  date: string;
  runId: string;
}

export async function fetchRecoveryObjects(
  environment: R2ObjectEnvironment,
  completionKey: string,
  outputDirectory: string,
  client: Pick<RecoveryR2Client, "head" | "download"> = createR2Client(environment),
): Promise<string> {
  const identity = parseCompletionKey(completionKey);
  const keys = {
    completion: completionKey,
    manifest: completionKey.replace(/\.complete\.json$/i, ".manifest.json"),
    artifact: completionKey.replace(/\.complete\.json$/i, ".tar.gz.age"),
  };
  const outputPath = assertRecoveryFetchOutputDirectory(outputDirectory);
  const stagingPath = mkdtempSync(join(dirname(outputPath), ".rivalhub-recovery-fetch-"));
  chmodSync(stagingPath, 0o700);
  let committed = false;

  try {
    const completionPath = join(stagingPath, "completion.json");
    fetchAndVerifyObject(client, keys.completion, completionPath);
    const completion = readJson(completionPath, assertRecoveryCompletionMarker);
    assertCompletionIdentity(completion, identity, keys.artifact);

    const sidecarPath = join(stagingPath, "sidecar.json");
    fetchAndVerifyObject(client, keys.manifest, sidecarPath);
    const sidecar = readJson(sidecarPath, assertRecoverySidecar);
    assertSidecarIdentity(sidecar, completion, identity, keys.artifact);
    if (sidecar.manifestSha256 !== completion.manifestSha256) {
      throw new Error("Recovery sidecar and completion manifest checksum differ; fetch aborted. ");
    }

    const artifactPath = join(stagingPath, "artifact.tar.gz.age");
    const artifactHead = fetchAndVerifyObject(client, keys.artifact, artifactPath);
    if (
      artifactHead.bytes !== sidecar.artifactBytes
      || artifactHead.sha256 !== sidecar.artifactSha256
      || completion.artifactSha256 !== artifactHead.sha256
    ) {
      throw new Error("Recovery artifact checksum/size does not match the verified sidecar; fetch aborted. ");
    }

    // Retain only the three verified objects. The encrypted artifact is not
    // decrypted here and no database or provider writer is ever contacted.
    renameSync(stagingPath, outputPath);
    committed = true;
    return outputPath;
  } finally {
    if (!committed) rmSync(stagingPath, { recursive: true, force: true });
  }
}

export function assertRecoveryFetchOutputDirectory(value: string | undefined): string {
  if (!value?.trim()) throw new Error("db:recovery:fetch 需要 --output <new restricted directory>。 ");
  const outputPath = resolve(value.trim());
  const parent = dirname(outputPath);
  if (!lstatSync(parent, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("db:recovery:fetch output parent must already be a directory. ");
  }
  if (existsSync(outputPath)) {
    throw new Error("db:recovery:fetch refuses to overwrite an existing output directory. ");
  }
  return outputPath;
}

function parseCompletionKey(value: string): RecoveryObjectIdentity {
  const match = value.match(/^production\/(daily|pre-release|manual)\/(\d{4}-\d{2}-\d{2})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.complete\.json$/i);
  if (!match) throw new Error("Recovery completion key identity is invalid; fetch aborted. ");
  return {
    backupClass: match[1] as RecoveryObjectIdentity["backupClass"],
    date: match[2]!,
    runId: match[3]!,
  };
}

function fetchAndVerifyObject(client: Pick<RecoveryR2Client, "head" | "download">, key: string, path: string) {
  const head = client.head(key);
  client.download(key, path);
  assertR2ContentReadback(path, { bytes: head.bytes, sha256: head.sha256 });
  return head;
}

function assertCompletionIdentity(
  completion: RecoveryCompletionMarker,
  identity: RecoveryObjectIdentity,
  artifactKey: string,
): void {
  if (completion.runId !== identity.runId || completion.artifactKey !== artifactKey) {
    throw new Error("Recovery completion marker does not match its object key; fetch aborted. ");
  }
}

function assertSidecarIdentity(
  sidecar: RecoverySidecar,
  completion: RecoveryCompletionMarker,
  identity: RecoveryObjectIdentity,
  artifactKey: string,
): void {
  if (
    sidecar.runId !== completion.runId
    || sidecar.artifactKey !== artifactKey
    || sidecar.artifactSha256 !== completion.artifactSha256
    || sidecar.backupClass !== identity.backupClass
    || sidecar.createdAt.slice(0, 10) !== identity.date
  ) {
    throw new Error("Recovery sidecar does not match the completion marker; fetch aborted. ");
  }
}

function readJson<T>(path: string, parser: (value: unknown) => T): T {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Recovery object JSON is invalid; fetch aborted. ");
  }
  return parser(value);
}

function parseArguments(args: readonly string[]): FetchArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("用法：tsx scripts/db/recovery/fetch.ts --completion-key <key> --output <new-directory>");
    }
    values.set(name.slice(2), value);
    index += 1;
  }
  const completionKey = values.get("completion-key");
  if (!completionKey) throw new Error("--completion-key 未设置；fetch aborted. ");
  const outputDirectory = values.get("output");
  if (!outputDirectory) throw new Error("--output 未设置；fetch aborted. ");
  return { completionKey, outputDirectory };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const environment = assertRecoveryFetchEnvironment(process.env);
  assertR2BucketName(environment.bucket);
  const output = await fetchRecoveryObjects(environment, args.completionKey, args.outputDirectory);
  console.log(`Recovery objects fetched into restricted directory: ${output}`);
}

if (process.argv[1]?.endsWith("fetch.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Recovery fetch failed.");
    process.exitCode = 1;
  });
}
