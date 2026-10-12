import { describe, expect, it } from "vitest";
import {
  startDraftSchema,
  pauseDraftSchema,
  resumeDraftSchema,
  skipDraftTurnSchema,
  pickPlayerSchema,
} from "@/lib/validators/draft";

const UUID = "00000000-0000-0000-0000-000000000001";

describe("draft command input", () => {
  it("控制命令接受合法 seasonId 并拒绝缺失或非法 ID", () => {
    for (const schema of [startDraftSchema, pauseDraftSchema, resumeDraftSchema, skipDraftTurnSchema]) {
      expect(schema.safeParse({ seasonId: UUID }).success).toBe(true);
      expect(schema.safeParse({ seasonId: "not-uuid" }).success).toBe(false);
      expect(schema.safeParse({}).success).toBe(false);
    }
  });

  it("选人命令接受完整的选人标识", () => {
    expect(pickPlayerSchema.safeParse({
      seasonId: UUID,
      entryId: "22222222-2222-4222-8222-222222222222",
      registrationId: "33333333-3333-4333-8333-333333333333",
      clientRequestId: "44444444-4444-4444-8444-444444444444",
    }).success).toBe(true);
  });

  it("选人命令拒绝缺失或非法 ID", () => {
    expect(pickPlayerSchema.safeParse({
      seasonId: "bad",
      entryId: UUID,
      registrationId: UUID,
    }).success).toBe(false);
  });
});
