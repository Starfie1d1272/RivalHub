import { expect, it } from "vitest";
import { vitalStatus } from "@/components/telemetry/analysis/Elements";

it("evaluates reference boundaries only with enough observed samples and complete coverage", () => {
  for (const [metric, threshold] of [["LCP", 2500], ["INP", 200], ["CLS", .1]] as const) {
    expect(vitalStatus(metric, 20, threshold).tone).toBe("ok");
    expect(vitalStatus(metric, 20, threshold + .01).tone).toBe("warn");
    expect(vitalStatus(metric, 19, 0).label).toContain("样本不足");
    expect(vitalStatus(metric, 20, 0, true).tone).toBe("warn");
    expect(vitalStatus(metric, 0, null).label).toBe("暂无有效样本");
  }
});
