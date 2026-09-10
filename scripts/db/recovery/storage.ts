import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

const LIST_PAGE_SIZE = 100;
const BUCKET_PAGE_SIZE = 1000;
const OBJECT_FILE_WIDTH = 8;

export interface StorageObjectRecord {
  bucket: string;
  objectPath: string;
  archivePath: string;
  bytes: number;
  contentType: string;
  sha256: string;
}

export interface StorageBucketRecord {
  id: string;
  name: string;
  public: boolean;
  fileSizeLimit: number | null;
  allowedMimeTypes: readonly string[] | null;
}

export interface StorageSnapshot {
  bucketCount: number;
  bucketInventorySha256: string;
  objectCount: number;
  totalBytes: number;
  inventorySha256: string;
  buckets: readonly StorageBucketRecord[];
  records: readonly StorageObjectRecord[];
}

export interface StorageObjectReference {
  bucket: string;
  objectPath: string;
}

export function assertActiveStorageReferencesStable(
  before: readonly StorageObjectReference[],
  after: readonly StorageObjectReference[],
): void {
  const beforeKeys = new Set(before.map(storageObjectReferenceKey));
  const afterKeys = new Set(after.map(storageObjectReferenceKey));
  const drifted = beforeKeys.size !== afterKeys.size
    || [...beforeKeys].some((key) => !afterKeys.has(key));
  if (drifted) {
    throw new Error("Active Storage object references changed during the backup window; canonical backup aborted. ");
  }
}

export async function snapshotStorage(
  client: SupabaseClient,
  storageRoot: string,
): Promise<StorageSnapshot> {
  const buckets = await listAllBuckets(client);
  const discovered: DiscoveredObject[] = [];
  for (const bucket of buckets) {
    await collectObjects(client, bucket.name, "", discovered);
  }

  discovered.sort((left, right) => left.bucket.localeCompare(right.bucket) || left.objectPath.localeCompare(right.objectPath));
  mkdirSync(join(storageRoot, "objects"), { recursive: true });
  const bucketInventoryText = `${JSON.stringify(buckets)}\n`;
  writeFileSync(join(storageRoot, "buckets.json"), bucketInventoryText, { flag: "wx" });
  const records: StorageObjectRecord[] = [];

  for (const [index, object] of discovered.entries()) {
    const downloaded = await client.storage.from(object.bucket).download(object.objectPath);
    if (downloaded.error || !downloaded.data) {
      throw new Error("Supabase Storage object download failed; canonical backup aborted. ");
    }
    const bytes = Buffer.from(await downloaded.data.arrayBuffer());
    const archivePath = `objects/${String(index + 1).padStart(OBJECT_FILE_WIDTH, "0")}.bin`;
    const localPath = resolve(storageRoot, archivePath);
    writeFileSync(localPath, bytes, { flag: "wx" });
    records.push({
      bucket: object.bucket,
      objectPath: object.objectPath,
      archivePath,
      bytes: bytes.byteLength,
      contentType: object.contentType,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }

  const indexText = `${records.map((record) => JSON.stringify(record)).join("\n")}${records.length ? "\n" : ""}`;
  writeFileSync(join(storageRoot, "index.ndjson"), indexText, { flag: "wx" });
  return {
    bucketCount: buckets.length,
    bucketInventorySha256: createHash("sha256").update(bucketInventoryText).digest("hex"),
    objectCount: records.length,
    totalBytes: records.reduce((total, record) => total + record.bytes, 0),
    inventorySha256: createHash("sha256").update(indexText).digest("hex"),
    buckets,
    records,
  };
}

export function assertActiveStorageReferencesCaptured(
  references: readonly StorageObjectReference[],
  records: readonly StorageObjectRecord[],
): void {
  const captured = new Set(records.map((record) => storageObjectReferenceKey(record)));
  const missing = references.filter((reference) => !captured.has(storageObjectReferenceKey(reference)));
  if (missing.length) {
    throw new Error("Active Storage object reference is missing from the snapshot; canonical backup aborted. ");
  }
}

function storageObjectReferenceKey(reference: StorageObjectReference): string {
  return `${reference.bucket}\u0000${reference.objectPath}`;
}

export async function restoreStorageSnapshot(
  client: SupabaseClient,
  storageRoot: string,
  activeEducationObjectKeys: ReadonlySet<string>,
): Promise<{ restoredObjects: number; restoredBytes: number; skippedExpiredEvidence: number; skippedExpiredEvidenceBytes: number }> {
  const records = readStorageIndex(resolve(storageRoot, "index.ndjson"));
  const snapshotEducationObjectKeys = new Set(
    records
      .filter((record) => record.bucket === "education-evidence")
      .map((record) => record.objectPath),
  );
  if ([...activeEducationObjectKeys].some((key) => !snapshotEducationObjectKeys.has(key))) {
    throw new Error("Active education evidence is missing from the Storage snapshot; restore aborted. ");
  }
  let restoredObjects = 0;
  let restoredBytes = 0;
  let skippedExpiredEvidence = 0;
  let skippedExpiredEvidenceBytes = 0;

  for (const record of records) {
    if (record.bucket === "education-evidence" && !activeEducationObjectKeys.has(record.objectPath)) {
      skippedExpiredEvidence += 1;
      skippedExpiredEvidenceBytes += record.bytes;
      continue;
    }
    const localPath = resolve(storageRoot, record.archivePath);
    assertWithinDirectory(storageRoot, localPath);
    const bytes = readFileSync(localPath);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== record.sha256 || bytes.byteLength !== record.bytes) {
      throw new Error("Storage snapshot checksum mismatch; restore aborted. ");
    }

    const uploaded = await client.storage.from(record.bucket).upload(record.objectPath, bytes, {
      upsert: true,
      contentType: record.contentType || "application/octet-stream",
    });
    if (uploaded.error) throw new Error("Storage object restore failed; restore aborted. ");

    const readback = await client.storage.from(record.bucket).download(record.objectPath);
    if (readback.error || !readback.data) throw new Error("Storage object read-back failed; restore aborted. ");
    const readbackChecksum = createHash("sha256").update(Buffer.from(await readback.data.arrayBuffer())).digest("hex");
    if (readbackChecksum !== record.sha256) throw new Error("Storage object read-back checksum mismatch; restore aborted. ");

    restoredObjects += 1;
    restoredBytes += record.bytes;
  }

  return { restoredObjects, restoredBytes, skippedExpiredEvidence, skippedExpiredEvidenceBytes };
}

export async function restoreStorageBuckets(
  client: SupabaseClient,
  storageRoot: string,
): Promise<number> {
  const buckets = readStorageBuckets(resolve(storageRoot, "buckets.json"));
  for (const bucket of buckets) {
    const existing = await client.storage.getBucket(bucket.name);
    if (existing.error && !isMissingBucketError(existing.error)) {
      throw new Error("Storage bucket read failed; restore aborted. ");
    }
    const options = {
      public: bucket.public,
      fileSizeLimit: bucket.fileSizeLimit ?? undefined,
      allowedMimeTypes: bucket.allowedMimeTypes ? [...bucket.allowedMimeTypes] : undefined,
    };
    const result = existing.data
      ? await client.storage.updateBucket(bucket.name, options)
      : await client.storage.createBucket(bucket.name, options);
    if (result.error) throw new Error("Storage bucket restore failed; restore aborted. ");
  }
  return buckets.length;
}

export function readStorageIndex(path: string): StorageObjectRecord[] {
  const text = readFileSync(path, "utf8");
  const records = text.trim() ? text.trimEnd().split("\n").map(parseStorageRecord) : [];
  const archivePaths = new Set<string>();
  const objectKeys = new Set<string>();
  for (const record of records) {
    if (archivePaths.has(record.archivePath) || objectKeys.has(`${record.bucket}\u0000${record.objectPath}`)) {
      throw new Error("Storage index contains duplicate object identity; restore aborted. ");
    }
    archivePaths.add(record.archivePath);
    objectKeys.add(`${record.bucket}\u0000${record.objectPath}`);
  }
  return records.sort((left, right) => left.archivePath.localeCompare(right.archivePath));
}

async function listAllBuckets(client: SupabaseClient): Promise<StorageBucketRecord[]> {
  const buckets: StorageBucketRecord[] = [];
  let offset = 0;
  while (true) {
    const result = await client.storage.listBuckets({
      limit: BUCKET_PAGE_SIZE,
      offset,
      sortColumn: "name",
      sortOrder: "asc",
    });
    if (result.error || !result.data) {
      throw new Error("Supabase Storage bucket inventory failed; canonical backup aborted. ");
    }
    for (const bucket of result.data) {
      if (bucket.type && bucket.type !== "STANDARD") {
        throw new Error("Supabase Storage contains an unsupported bucket type; canonical backup aborted. ");
      }
      buckets.push({
        id: bucket.id,
        name: bucket.name,
        public: bucket.public,
        fileSizeLimit: bucket.file_size_limit ?? null,
        allowedMimeTypes: bucket.allowed_mime_types ?? null,
      });
    }
    if (result.data.length < BUCKET_PAGE_SIZE) break;
    offset += result.data.length;
  }
  return buckets.sort((left, right) => left.name.localeCompare(right.name));
}

async function collectObjects(
  client: SupabaseClient,
  bucket: string,
  prefix: string,
  output: DiscoveredObject[],
): Promise<void> {
  let offset = 0;
  while (true) {
    const listed = await client.storage.from(bucket).list(prefix || undefined, {
      limit: LIST_PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (listed.error || !listed.data) {
      throw new Error("Supabase Storage object inventory failed; canonical backup aborted. ");
    }

    for (const item of listed.data) {
      const objectPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null && item.metadata === null) {
        await collectObjects(client, bucket, objectPath, output);
        continue;
      }
      output.push({
        bucket,
        objectPath,
        contentType: item.metadata?.mimetype ?? "application/octet-stream",
      });
    }

    if (listed.data.length < LIST_PAGE_SIZE) return;
    offset += listed.data.length;
  }
}

function parseStorageRecord(line: string): StorageObjectRecord {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("Storage index 格式无效；restore aborted. ");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Storage index record 格式无效；restore aborted. ");
  }
  const record = value as Partial<StorageObjectRecord>;
  if (
    typeof record.bucket !== "string"
    || typeof record.objectPath !== "string"
    || typeof record.archivePath !== "string"
    || !isNonNegativeInteger(record.bytes)
    || typeof record.contentType !== "string"
    || !isSha256(record.sha256)
    || !isStorageBucketName(record.bucket)
    || !record.objectPath
    || record.objectPath.startsWith("/")
    || record.objectPath.includes("\\")
    || record.objectPath.split("/").some((part) => part === "" || part === "." || part === "..")
    || !/^objects\/\d{8}\.bin$/.test(record.archivePath)
  ) {
    throw new Error("Storage index record 缺少字段；restore aborted. ");
  }
  return record as StorageObjectRecord;
}

export function readStorageBuckets(path: string): StorageBucketRecord[] {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Storage bucket inventory 格式无效；restore aborted. ");
  }
  if (!Array.isArray(value)) throw new Error("Storage bucket inventory 格式无效；restore aborted. ");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Storage bucket record 格式无效；restore aborted. ");
    const bucket = entry as Partial<StorageBucketRecord>;
    if (
      typeof bucket.id !== "string"
      || typeof bucket.name !== "string"
      || typeof bucket.public !== "boolean"
      || !isStorageBucketName(bucket.name)
      || (bucket.fileSizeLimit !== null && !isNonNegativeInteger(bucket.fileSizeLimit))
      || (bucket.allowedMimeTypes !== null && (!Array.isArray(bucket.allowedMimeTypes) || bucket.allowedMimeTypes.some((mime) => typeof mime !== "string")))
    ) throw new Error("Storage bucket record 缺少字段；restore aborted. ");
    return bucket as StorageBucketRecord;
  });
}

function assertWithinDirectory(root: string, path: string): void {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  const pathFromRoot = relative(resolvedRoot, resolvedPath);
  if (!pathFromRoot || pathFromRoot.startsWith("..") || pathFromRoot.includes("/../") || pathFromRoot.includes("\\..\\")) {
    throw new Error("Storage archive path escapes the recovery staging directory. ");
  }
}

interface DiscoveredObject {
  bucket: string;
  objectPath: string;
  contentType: string;
}

function isMissingBucketError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  return candidate.status === 404 || candidate.statusCode === "404" || candidate.code === "NotFound";
}

function isStorageBucketName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{1,61}[A-Za-z0-9]$/.test(value) && !value.includes("..");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
