import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatchLiveViewing } from "./MatchLiveViewing";
const commentators = [{ userId: "commentator", displayName: "解说甲", perfectName: null, steamName: null, liveStreamUrl: "https://live.example/room" }];
describe("match live viewing", () => {
  it.each(["scheduled", "in_progress"] as const)("offers the room for %s without claiming LIVE", (status) => {
    const html = renderToStaticMarkup(<MatchLiveViewing status={status} commentators={commentators} />);
    expect(html).toContain('href="https://live.example/room"');
    expect(html).toContain("进入直播间");
    expect(html).toContain("解说甲");
    expect(html).not.toContain("LIVE");
  });
  it.each(["finished", "cancelled"] as const)("hides stale room links for %s", (status) => {
    expect(renderToStaticMarkup(<MatchLiveViewing status={status} commentators={commentators} />)).toBe("");
  });
  it("ignores absent and unsafe resources", () => {
    expect(renderToStaticMarkup(<MatchLiveViewing status="scheduled" commentators={[{ ...commentators[0], liveStreamUrl: "javascript:alert(1)" }]} />)).toBe("");
  });
});
