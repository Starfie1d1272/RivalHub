import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

import { spawnSync } from "node:child_process";
import { createR2Client } from "../../scripts/db/recovery/r2";

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
});
