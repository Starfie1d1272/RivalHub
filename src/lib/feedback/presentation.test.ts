import { describe, expect, it } from "vitest";
import { getFeedbackUserLabel } from "./presentation";

describe("feedback user presentation", () => {
  it("uses canonical identity fields without making a full email the user label", () => {
    expect(getFeedbackUserLabel({ userId: "user-1", displayName: null, perfectName: null, steamName: "Steam Player", email: "private@example.test" })).toBe("Steam Player");
    expect(getFeedbackUserLabel({ userId: "user-2", displayName: null, perfectName: null, steamName: null, email: "private@example.test" })).toBe("private");
    expect(getFeedbackUserLabel({ userId: null, displayName: null, perfectName: null, steamName: null, email: "private@example.test" })).toBeNull();
  });
});
