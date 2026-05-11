import { describe, expect, it } from "vitest";
import { pickPlayerSchema } from "@/lib/validators/draft";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("pickPlayerSchema", () => {
  it("accepts the required pick identifiers", () => {
    const parsed = pickPlayerSchema.safeParse({
      seasonId: uuid,
      teamId: "22222222-2222-4222-8222-222222222222",
      registrationId: "33333333-3333-4333-8333-333333333333",
      clientRequestId: "44444444-4444-4444-8444-444444444444",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects missing or malformed ids", () => {
    const parsed = pickPlayerSchema.safeParse({
      seasonId: "bad",
      teamId: uuid,
      registrationId: uuid,
    });

    expect(parsed.success).toBe(false);
  });
});
