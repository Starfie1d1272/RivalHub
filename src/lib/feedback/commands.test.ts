import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_FEEDBACK_PER_MINUTE,
  AUTHENTICATED_FEEDBACK_COOLDOWN_MS,
  FEEDBACK_BODY_DEDUP_WINDOW_MS,
  fingerprintFeedbackBody,
} from "./commands";

describe("feedback command constants and deduplication contracts", () => {
  it("enforces expected rate limit and cooldown thresholds", () => {
    expect(ANONYMOUS_FEEDBACK_PER_MINUTE).toBe(20);
    expect(FEEDBACK_BODY_DEDUP_WINDOW_MS).toBe(60_000);
    expect(AUTHENTICATED_FEEDBACK_COOLDOWN_MS).toBe(30_000);
  });

  it("computes deterministic SHA-256 fingerprint for identical normalized bodies", () => {
    const fp1 = fingerprintFeedbackBody("比赛比分显示有延迟");
    const fp2 = fingerprintFeedbackBody("比赛比分显示有延迟");
    const fp3 = fingerprintFeedbackBody("比赛比分显示正常");

    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fp3);
    expect(fp1).toHaveLength(64);
  });
});
