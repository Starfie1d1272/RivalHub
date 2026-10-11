import { describe, expect, it } from "vitest";
import { commandFor, runFullChecks } from "../../../scripts/ci/run-static-task.mjs";

describe("affected static task commands", () => {
  // Grouping must never let a failed early check disappear behind later success
  // or stop collecting another independent correctness check.
  it.each(["exit", "signal", "spawn"])("retains %s failure while completing all FULL checks", (failure) => {
    const seen = [];
    const status = runFullChecks(task => {
      seen.push(task);
      if (task === "type-tests") {
        if (failure === "signal" || failure === "spawn") throw new Error(failure);
        return 1;
      }
      return 0;
    });
    expect(status).toBe(1);
    expect(seen).toEqual(["type-app", "type-tests", "type-scripts", "lint", "architecture", "dead-code"]);
  });
  it("requires every grouped FULL check to succeed", () => {
    expect(runFullChecks(() => 0)).toBe(0);
    expect(runFullChecks(() => null)).toBe(1);
  });
  it("rejects an empty explicit selection", () => {
    expect(() => commandFor("unit-explicit-unit-react-jsdom", "unit-react-jsdom")).toThrow("must not be empty");
  });
  it("runs the executable architecture contract", () => {
    expect(commandFor("architecture")).toEqual(["architecture:check"]);
  });

  it("passes the planned changed paths to eslint", () => {
    expect(commandFor(
      "lint-changed",
      undefined,
      [],
      [],
      ["src/example.ts", "tests/unit/example.test.ts"],
    )).toEqual([
      "exec",
      "eslint",
      "--max-warnings=0",
      "src/example.ts",
      "tests/unit/example.test.ts",
    ]);
  });

  it("runs explicit global contracts directly instead of passing them to vitest related", () => {
    expect(commandFor(
      "unit-explicit-unit-domain-node",
      "unit-domain-node",
      [],
      ["tests/unit/quality/product-language.test.ts"],
    )).toEqual([
      "exec",
      "vitest",
      "run",
      "--project",
      "unit-domain-node",
      "tests/unit/quality/product-language.test.ts",
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
