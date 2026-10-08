import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../../../.github/workflows/refresh-preview-data.yml", import.meta.url), "utf8");
describe("preview mirror workflow contract", () => {
  it("is protected, serialized, and split between production read and staging write", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain("group: rivalhub-preview-mirror-refresh");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("environment: staging");
    expect(workflow).toContain("RIVALHUB_ALLOW_REMOTE_DB_WRITE: staging");
    expect(workflow).toContain("retention-days: 1");
    expect(workflow).not.toContain("RIVALHUB_ALLOW_REMOTE_DB_WRITE: production");
    expect(workflow).toContain("RIVALHUB_PREVIEW_RESET_CONFIRM");
  });
});
