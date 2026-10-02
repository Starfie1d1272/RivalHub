import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { snapshotStorage } from "../../scripts/db/recovery/storage";

const bucket = { id: "team-logos", name: "team-logos", type: "STANDARD", public: true };
const object = { id: "object-id", name: "private-object-key", metadata: { mimetype: "image/png" } };

function clientWithFailure(stage: "bucket" | "object" | "download", error: unknown) {
  const failure = { data: null, error };
  const listBuckets = vi.fn().mockResolvedValue(stage === "bucket" ? failure : { data: [bucket], error: null });
  const list = vi.fn().mockResolvedValue(stage === "object" ? failure : { data: [object], error: null });
  const download = vi.fn().mockResolvedValue(failure);
  return { client: { storage: { listBuckets, from: () => ({ list, download }) } } as unknown as SupabaseClient, listBuckets, list, download };
}

describe("Storage backup failure diagnostics", () => {
  it.each(["bucket", "object", "download"] as const)("fails closed at %s with a safe actionable billing status", async (stage) => {
    const root = mkdtempSync(join(tmpdir(), "recovery-storage-"));
    const { client, listBuckets, list, download } = clientWithFailure(stage, {
      status: 402, message: "secret-token private-object-key signed-url", code: "private-code",
    });
    try {
      await expect(snapshotStorage(client, root)).rejects.toThrow(/HTTP 402.*canonical backup aborted.*Supabase Dashboard/);
      expect(listBuckets).toHaveBeenCalledTimes(1);
      expect(list).toHaveBeenCalledTimes(stage === "bucket" ? 0 : 1);
      expect(download).toHaveBeenCalledTimes(stage === "download" ? 1 : 0);
      expect(readdirSync(root)).not.toContain("index.ndjson");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    [{ statusCode: "403", message: "secret" }, "HTTP 403", "project permissions"],
    [{ status: 503, message: "secret" }, "HTTP 503", "canonical backup aborted"],
    [{ statusCode: "402 secret", message: "secret" }, "HTTP status unavailable", "canonical backup aborted"],
    [null, "HTTP status unavailable", "canonical backup aborted"],
  ])("does not expose unvalidated provider data", async (error, status, guidance) => {
    const root = mkdtempSync(join(tmpdir(), "recovery-storage-"));
    try {
      const { client } = clientWithFailure("bucket", error);
      const failure = await snapshotStorage(client, root).catch((cause: Error) => cause);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(status);
      expect((failure as Error).message).toContain(guidance);
      expect((failure as Error).message).not.toContain("secret");
      expect(readdirSync(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
