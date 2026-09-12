import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../../../.github/workflows/refresh-preview-data.yml", import.meta.url), "utf8");

describe("preview mirror workflow contract", () => {
  it("is protected, serialized, and split between production read and staging write", () => {
    expect(workflow).toContain("name: Refresh Preview Data");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain("cron: \"17 3 * * *\"");
    expect(workflow).toContain("group: rivalhub-preview-mirror-refresh");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("environment: staging");
    expect(workflow).toContain("RIVALHUB_ALLOW_REMOTE_DB_WRITE: staging");
    expect(workflow).toContain("retention-days: 1");
    expect(workflow).not.toContain("RIVALHUB_ALLOW_REMOTE_DB_WRITE: production");
    expect(workflow).toContain("RIVALHUB_PREVIEW_RESET_CONFIRM");
  });

  it("keeps the refresh implementation focused on reset/import rather than a read-only role", () => {
    const refresh = readFileSync(new URL("../../../scripts/db/preview/refresh.ts", import.meta.url), "utf8");
    expect(refresh).toContain("DROP SCHEMA IF EXISTS public CASCADE");
    expect(refresh).toContain("TRUNCATE");
    expect(refresh).toContain("applyCurrentMigrations");
    expect(refresh).not.toContain("rivalhub_preview_ro");
    expect(workflow).toContain("RIVALHUB_PREVIEW_PUBLIC_ASSET_ALLOWLIST");
    expect(workflow).not.toContain("RIVALHUB_PREVIEW_RO_PASSWORD");
  });

  it("defers the Preview mirror banner query until request time", () => {
    const layout = readFileSync(new URL("../../../src/app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toContain("<Suspense fallback={null}><PreviewMirrorBanner /></Suspense>");
    expect(layout.indexOf("await connection();")).toBeLessThan(layout.indexOf("await readPreviewMirrorIdentity()"));
  });
});
