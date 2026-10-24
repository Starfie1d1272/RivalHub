import { describe, it, expect } from "vitest";
import { recordingInput, hasMatchRecording } from "@/lib/postmatch/recording-types";
const row = { id: "00000000-0000-0000-0000-000000000001", commentatorUserId: "00000000-0000-0000-0000-000000000002", title: "图二", url: "https://video.example/watch?v=2" };
describe("public recording input and completion", () => {
  it("preserves explicit labels and validates external URLs without accepting credentials", () => {
    expect(recordingInput.parse(row)).toEqual(row);
    for (const url of ["javascript:alert(1)", "data:text/html,x", "https://user:password@example.com", "not a url"])
      expect(recordingInput.safeParse({ ...row, url }).success).toBe(false);
    expect(recordingInput.safeParse({ ...row, title: " " }).success).toBe(false);
    expect(recordingInput.safeParse({ ...row, actorId: row.id }).success).toBe(false);
  });
  it("uses either legacy or grouped recordings as the same completion fact", () => {
    expect(hasMatchRecording({ videoUrl: null, recordings: [] })).toBe(false);
    expect(hasMatchRecording({ videoUrl: row.url, recordings: [] })).toBe(true);
    expect(hasMatchRecording({ videoUrl: null, recordings: [row] })).toBe(true);
  });
});
