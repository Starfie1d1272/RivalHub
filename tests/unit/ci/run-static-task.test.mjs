import { describe, expect, it } from "vitest";
import { commandFor } from "../../../scripts/ci/run-static-task.mjs";

describe("affected static task commands", () => {
  it("runs explicit global contracts directly instead of passing them to vitest related", () => {
    expect(commandFor(
      "unit-explicit-unit-domain-node",
      "unit-domain-node",
      [],
      ["tests/unit/quality/e2e-contract.test.ts"],
    )).toEqual([
      "exec",
      "vitest",
      "run",
      "--project",
      "unit-domain-node",
      "--passWithNoTests",
      "tests/unit/quality/e2e-contract.test.ts",
    ]);
  });

  it("passes only source paths to vitest related", () => {
    expect(commandFor(
      "unit-related-unit-domain-node",
      "unit-domain-node",
      ["src/lib/major/opening.ts"],
    )).toEqual([
      "exec",
      "vitest",
      "related",
      "--project",
      "unit-domain-node",
      "--run",
      "--passWithNoTests",
      "src/lib/major/opening.ts",
    ]);
  });
});
