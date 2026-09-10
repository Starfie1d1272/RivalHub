import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

import { spawnSync } from "node:child_process";
import { createR2Client } from "../../scripts/db/recovery/r2";
import {
  applyR2RetentionConfig,
  assertNoConflictingLifecycleRules,
  R2_LIFECYCLE_RULES,
  R2_LOCK_RULES,
  verifyR2NoCustomDomains,
  verifyR2NoManagedPublicAccess,
} from "../../scripts/db/recovery/r2-config";

const spawnSyncMock = vi.mocked(spawnSync);

function mockAwsResult(overrides: Partial<ReturnType<typeof spawnSync>> = {}): ReturnType<typeof spawnSync> {
  return {
    error: undefined,
    status: 0,
    signal: null,
    stdout: "",
    stderr: "",
    ...overrides,
  } as ReturnType<typeof spawnSync>;
}

describe("recovery R2 provider command contract", () => {
  it("passes the download destination as the final get-object positional argument", () => {
    spawnSyncMock.mockReturnValue(mockAwsResult());
    const client = createR2Client({
      accountId: "0123456789abcdef0123456789abcdef",
      bucket: "rivalhub-recovery",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
    });

    client.download("production/hourly/2026-09-10/run.tar.gz.age", "/tmp/rivalhub-readback.age");

    expect(spawnSyncMock).toHaveBeenCalledOnce();
    const [executable, args] = spawnSyncMock.mock.calls[0] ?? [];
    expect(executable).toBe("aws");
    expect(args).toEqual([
      "s3api",
      "get-object",
      "--endpoint-url",
      "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
      "--bucket",
      "rivalhub-recovery",
      "--key",
      "production/hourly/2026-09-10/run.tar.gz.age",
      resolve("/tmp/rivalhub-readback.age"),
    ]);
    expect(args).not.toContain("--outfile");
  });

  it("retains bounded, redacted provider stderr without exposing credentials", () => {
    const accessKeyId = "access-key-for-test";
    const secretAccessKey = "secret-key-for-test";
    spawnSyncMock.mockReturnValue(mockAwsResult({
      status: 1,
      stderr: `fatal: AWS_ACCESS_KEY_ID=${accessKeyId} AWS_SECRET_ACCESS_KEY=${secretAccessKey} ${"diagnostic ".repeat(500)}`,
    }));
    const client = createR2Client({
      accountId: "0123456789abcdef0123456789abcdef",
      bucket: "rivalhub-recovery",
      accessKeyId,
      secretAccessKey,
    });

    let thrown: unknown;
    try {
      client.head("production/hourly/2026-09-10/run.tar.gz.age");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = thrown instanceof Error ? thrown.message : "";
    expect(message).toContain("fatal:");
    expect(message).not.toContain(accessKeyId);
    expect(message).not.toContain(secretAccessKey);
    expect(message).toContain("[REDACTED]");
    expect(message.length).toBeLessThan(1_500);
  });

  describe("R2 provider retention and privacy contract", () => {
    const originalFetch = globalThis.fetch;

    it("rejects unknown overlapping destructive lifecycle rules but preserves unrelated rules", () => {
      // Unrelated rules (e.g. staging, logs) are preserved
      expect(() => assertNoConflictingLifecycleRules([
        { id: "cleanup-logs", enabled: true, conditions: { prefix: "logs/" }, deleteObjectsTransition: { condition: { type: "Age", maxAge: 86400 } } },
        { id: "staging-retention", enabled: true, conditions: { prefix: "staging/" }, deleteObjectsTransition: { condition: { type: "Age", maxAge: 86400 } } },
      ])).not.toThrow();

      // Root bucket-level destructive rule overlaps with production/ and must be rejected
      expect(() => assertNoConflictingLifecycleRules([
        { id: "expire-everything", enabled: true, conditions: { prefix: "" }, deleteObjectsTransition: { condition: { type: "Age", maxAge: 86400 } } },
      ])).toThrow(/destructive rule/);

      // Unknown production/ destructive rule must be rejected
      expect(() => assertNoConflictingLifecycleRules([
        { id: "unknown-prod-purge", enabled: true, conditions: { prefix: "production/" }, deleteObjectsTransition: { condition: { type: "Age", maxAge: 86400 } } },
      ])).toThrow(/destructive rule/);

      // Unknown subprefix destructive rule must be rejected
      expect(() => assertNoConflictingLifecycleRules([
        { id: "short-hourly", enabled: true, conditions: { prefix: "production/hourly/" }, deleteObjectsTransition: { condition: { type: "Age", maxAge: 3600 } } },
      ])).toThrow(/destructive rule/);
    });

    it("fails closed when canonical bucket has managed r2.dev public access enabled", async () => {
      const config = {
        accountId: "0123456789abcdef0123456789abcdef",
        bucket: "rivalhub-recovery",
        apiToken: "cloudflare-token",
      };

      globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
        const urlStr = String(url);
        if (urlStr.includes("/domains/managed")) {
          return new Response(JSON.stringify({ success: true, result: { enabled: true, domain: "rivalhub.r2.dev" } }), { status: 200 });
        }
        return new Response(JSON.stringify({ success: true, result: {} }), { status: 200 });
      });

      try {
        await expect(verifyR2NoManagedPublicAccess(config)).rejects.toThrow(/managed r2\.dev public access/);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("fails closed when canonical bucket has enabled custom domain", async () => {
      const config = {
        accountId: "0123456789abcdef0123456789abcdef",
        bucket: "rivalhub-recovery",
        apiToken: "cloudflare-token",
      };

      globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
        const urlStr = String(url);
        if (urlStr.includes("/domains/custom")) {
          return new Response(JSON.stringify({
            success: true,
            result: { domains: [{ domain: "backup.example.com", enabled: true }] },
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ success: true, result: {} }), { status: 200 });
      });

      try {
        await expect(verifyR2NoCustomDomains(config)).rejects.toThrow(/custom domain/);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("applies bucket lock first, verifies lock, then applies lifecycle, and performs full read-back", async () => {
      const callLog: string[] = [];

      globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(url);
        const method = init?.method ?? "GET";

        if (urlStr.endsWith("/lock")) {
          callLog.push(`${method} lock`);
          if (method === "GET") {
            return new Response(JSON.stringify({ success: true, result: { rules: R2_LOCK_RULES } }), { status: 200 });
          }
          return new Response(JSON.stringify({ success: true, result: {} }), { status: 200 });
        }
        if (urlStr.endsWith("/lifecycle")) {
          callLog.push(`${method} lifecycle`);
          if (method === "GET") {
            return new Response(JSON.stringify({ success: true, result: { rules: R2_LIFECYCLE_RULES } }), { status: 200 });
          }
          return new Response(JSON.stringify({ success: true, result: {} }), { status: 200 });
        }
        if (urlStr.endsWith("/domains/managed")) {
          callLog.push(`${method} domains/managed`);
          return new Response(JSON.stringify({ success: true, result: { enabled: false } }), { status: 200 });
        }
        if (urlStr.endsWith("/domains/custom")) {
          callLog.push(`${method} domains/custom`);
          return new Response(JSON.stringify({ success: true, result: { domains: [] } }), { status: 200 });
        }
        return new Response(JSON.stringify({ success: true, result: {} }), { status: 200 });
      });

      try {
        await applyR2RetentionConfig({
          RIVALHUB_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
          RIVALHUB_R2_BUCKET: "rivalhub-recovery",
          CLOUDFLARE_API_TOKEN: "cf-token",
        });

        // Verifies order: lock is applied and verified before lifecycle is applied
        const putLockIndex = callLog.indexOf("PUT lock");
        const getLockVerifyIndex = callLog.indexOf("GET lock", putLockIndex);
        const putLifecycleIndex = callLog.indexOf("PUT lifecycle");
        const fullReadbackLifecycleIndex = callLog.lastIndexOf("GET lifecycle");
        const fullReadbackLockIndex = callLog.lastIndexOf("GET lock");

        expect(putLockIndex).toBeGreaterThan(-1);
        expect(getLockVerifyIndex).toBeGreaterThan(putLockIndex);
        expect(putLifecycleIndex).toBeGreaterThan(getLockVerifyIndex);
        expect(fullReadbackLifecycleIndex).toBeGreaterThan(putLifecycleIndex);
        expect(fullReadbackLockIndex).toBeGreaterThan(putLifecycleIndex);
        expect(callLog).toContain("GET domains/managed");
        expect(callLog).toContain("GET domains/custom");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
