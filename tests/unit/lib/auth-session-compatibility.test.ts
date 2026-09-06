import { unsealData } from "iron-session";
import { describe, expect, it } from "vitest";

const V8_TEST_PASSWORD = "iron-session-v8-compatibility-test-password-0123456789";
// Captured from iron-session@8.0.4 with the test-only password and ttl: 0.
const V8_SESSION_SEAL =
  "Fe26.2*1*b24ab8e386ed7ca74c258b8b3e180d30bfaaed4c8da447d60370b0ddf66a5a4b*0_ftrMhYCszhVelJw4Z9ew*49BbtGSYz4veqMax5gAro9Ub9ZhIxa9XFPtEr2pvXZDhgW3F7oy9Jph5fCGwrsR-vs9R9DyefRvzY6XU150dIw**ff3fe83483804187b0804cf742dffb216110535fbb33e4a54d68d1b532ef0e49*YU0OMkd5IjUB2qXVcMcpKj7T7c7QXlEgDH5UTrkJUfU~2";

describe("iron-session cookie compatibility", () => {
  it("reads a v8 seal after upgrading to v9", async () => {
    await expect(
      unsealData<{ userId: string; email: string }>(V8_SESSION_SEAL, {
        password: V8_TEST_PASSWORD,
        ttl: 0,
      }),
    ).resolves.toEqual({ userId: "user-1", email: "player@example.test" });
  });
});
