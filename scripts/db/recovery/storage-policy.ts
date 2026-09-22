import type { Pool } from "pg";

export type StorageRecoveryClass = "durable" | "temporary-sensitive";
export type StorageRestoreMode = "always" | "active-reference-only";

export interface StorageRecoveryPolicy {
  bucket: string;
  recoveryClass: StorageRecoveryClass;
  restoreMode: StorageRestoreMode;
}

export interface ManagedStorageReference {
  bucket: string;
  objectPath: string;
}

export const STORAGE_RECOVERY_POLICIES: readonly StorageRecoveryPolicy[] = [
  { bucket: "team-logos", recoveryClass: "durable", restoreMode: "always" },
  { bucket: "season-public-assets", recoveryClass: "durable", restoreMode: "always" },
  { bucket: "education-evidence", recoveryClass: "temporary-sensitive", restoreMode: "active-reference-only" },
] as const;

export function getStorageRecoveryPolicy(bucket: string): StorageRecoveryPolicy {
  const policy = STORAGE_RECOVERY_POLICIES.find((candidate) => candidate.bucket === bucket);
  if (!policy) {
    throw new Error(`Storage bucket ${bucket} has no recovery policy; canonical backup/restore aborted. `);
  }
  return policy;
}

export function assertSupportedStorageBucket(bucket: {
  name?: unknown;
  type?: unknown;
}): StorageRecoveryPolicy {
  if (typeof bucket.name !== "string" || bucket.type !== "STANDARD") {
    throw new Error("Supabase Storage bucket type is missing or unsupported; canonical backup/restore aborted. ");
  }
  return getStorageRecoveryPolicy(bucket.name);
}

export async function readManagedStorageReferences(
  pool: Pick<Pool, "query">,
): Promise<readonly ManagedStorageReference[]> {
  const educationPolicy = getStorageRecoveryPolicy("education-evidence");
  if (educationPolicy.restoreMode !== "active-reference-only") {
    throw new Error("Storage recovery policy for education-evidence is not reference-owned; recovery aborted. ");
  }
  const result = await pool.query<{ evidence_object_key: string }>(
    "SELECT evidence_object_key FROM public.education_verifications WHERE evidence_object_key IS NOT NULL",
  );
  const references = result.rows.map((row) => ({
    bucket: educationPolicy.bucket,
    objectPath: row.evidence_object_key,
  }));
  const identities = new Set<string>();
  return references.filter((reference) => {
    const identity = `${reference.bucket}\u0000${reference.objectPath}`;
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
}
