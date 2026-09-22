import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(process.cwd());
const readWorkflow = (path) => readFileSync(resolve(projectRoot, path), "utf8");

describe("PR metadata workflow ownership", () => {
  it("keeps edited out of code CI and runs title validation on every relevant PR SHA or edit", () => {
    const codeCi = readWorkflow(".github/workflows/ci.yml");
    const metadata = readWorkflow(".github/workflows/pr-metadata.yml");

    expect(codeCi).toContain("types: [opened, synchronize, reopened, ready_for_review]");
    expect(codeCi).not.toContain("pr_title:");
    expect(codeCi).not.toContain("TITLE_RESULT:");
    expect(metadata).toContain("types: [opened, synchronize, reopened, edited, ready_for_review]");
    expect(metadata).toContain("name: pr-title");
    expect(metadata).toContain("PR_TITLE: ${{ github.event.pull_request.title }}");
  });
});
