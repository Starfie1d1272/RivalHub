import { describe, expect, it } from "vitest";
import { getPublicLiveCommentators, getPostMatchCompletion } from "@/lib/postmatch/service";

describe("post-match presentation", () => {
  const commentators = [{ liveStreamUrl: "https://live.example/a" }, { liveStreamUrl: null }, { liveStreamUrl: "https://live.example/b" }];
  it("shows each current live room only before a match finishes", () => {
    expect(getPublicLiveCommentators("scheduled", commentators)).toHaveLength(2);
    expect(getPublicLiveCommentators("in_progress", commentators)).toHaveLength(2);
    expect(getPublicLiveCommentators("finished", commentators)).toEqual([]);
  });
  it("derives completion without any payment state", () => {
    expect(getPostMatchCompletion(null, null)).toBe("pending_collection");
    expect(getPostMatchCompletion(new Date(), null)).toBe("waiting_video");
    expect(getPostMatchCompletion(new Date(), "https://video.example/match")).toBe("completed");
  });
});
