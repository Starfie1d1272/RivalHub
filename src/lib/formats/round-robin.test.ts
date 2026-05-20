import { describe, expect, it } from "vitest";
import { roundRobinExecutor } from "./round-robin";

describe("round-robin executor", () => {
  it("exposes the stage executor contract", () => {
    expect(roundRobinExecutor).toEqual({
      initialize: expect.any(Function),
      isComplete: expect.any(Function),
      getQualifiers: expect.any(Function),
    });
  });
});
