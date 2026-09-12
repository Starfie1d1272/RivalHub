import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  ensurePreviewTeamLogoBucket,
  importAndMigrateSnapshot,
  PreviewRefreshPhaseError,
  runPreviewRefreshPhase,
} from "../../../scripts/db/preview/refresh";
import type { MirrorSnapshot } from "../../../scripts/db/preview/snapshot";

describe("preview mirror refresh", () => {
  it("imports production-derived rows before applying current migrations", async () => {
    const phases: string[] = [];
    let value = "empty";

    await importAndMigrateSnapshot({} as PoolClient, {} as MirrorSnapshot, true, {
      importSnapshot: async () => { value = "production-derived"; phases.push("import"); },
      verify: async () => { phases.push(`verify:${value}`); },
      migrateCurrent: async () => {
        expect(value).toBe("production-derived");
        value = "current-migration";
        phases.push("migrate");
      },
    });

    expect(phases).toEqual([
      "import",
      "verify:production-derived",
      "migrate",
      "verify:current-migration",
    ]);
  });

  it("bootstraps the fixed dev team logo bucket when it is missing", async () => {
    const getBucket = vi.fn().mockResolvedValue({ data: null, error: { status: 404 } });
    const createBucket = vi.fn().mockResolvedValue({ data: null, error: null });
    const updateBucket = vi.fn();

    await ensurePreviewTeamLogoBucket({ getBucket, createBucket, updateBucket });

    expect(createBucket).toHaveBeenCalledWith("team-logos", {
      public: true,
      fileSizeLimit: 1_048_576,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    });
    expect(updateBucket).not.toHaveBeenCalled();
  });

  it("reconciles only the fixed dev team logo bucket contract when it exists", async () => {
    const getBucket = vi.fn().mockResolvedValue({ data: { id: "team-logos" }, error: null });
    const createBucket = vi.fn();
    const updateBucket = vi.fn().mockResolvedValue({ data: null, error: null });

    await ensurePreviewTeamLogoBucket({ getBucket, createBucket, updateBucket });

    expect(updateBucket).toHaveBeenCalledWith("team-logos", {
      public: true,
      fileSizeLimit: 1_048_576,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    });
    expect(createBucket).not.toHaveBeenCalled();
  });

  it("reports a safe phase without exposing the provider error", async () => {
    const logs: string[] = [];
    await expect(runPreviewRefreshPhase(
      "public asset upload",
      async () => { throw new Error("raw provider error"); },
      (message) => logs.push(message),
    )).rejects.toMatchObject({
      phase: "public asset upload",
      message: "Preview mirror phase failed: public asset upload",
    } satisfies Partial<PreviewRefreshPhaseError>);
    expect(logs).toEqual(["Preview mirror phase: public asset upload"]);
  });
});
