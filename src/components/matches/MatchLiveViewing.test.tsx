import React from "react";
/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getBilibiliEmbedUrl, MatchLiveViewing, parseBilibiliLiveRoomId } from "./MatchLiveViewing";

const commentators = [
  { userId: "commentator", displayName: "解说甲", perfectName: null, steamName: null, liveStreamUrl: "https://live.example/room" },
];

const bilibiliCommentators = [
  { userId: "bilibili-commentator", displayName: "解说乙", perfectName: null, steamName: null, liveStreamUrl: "https://live.bilibili.com/123456" },
];

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

  describe("bilibili progressive enhancement", () => {
    it("correctly parses numeric bilibili room IDs", () => {
      expect(parseBilibiliLiveRoomId("https://live.bilibili.com/123456")).toBe("123456");
      expect(parseBilibiliLiveRoomId("https://live.bilibili.com/123456/")).toBe("123456");
      expect(parseBilibiliLiveRoomId("http://live.bilibili.com/123456?broadcast_type=0")).toBe("123456");
      expect(parseBilibiliLiveRoomId("https://live.bilibili.com/abc")).toBe(null);
      expect(parseBilibiliLiveRoomId("https://example.com/123456")).toBe(null);
      expect(parseBilibiliLiveRoomId(null)).toBe(null);
    });

    it("renders click-to-load and external fallback during in_progress", () => {
      const html = renderToStaticMarkup(<MatchLiveViewing status="in_progress" commentators={bilibiliCommentators} />);
      expect(html).toContain("加载站内播放器");
      expect(html).toContain("在 Bilibili 打开");
      expect(html).toContain("https://live.bilibili.com/123456");
      expect(html).not.toContain("LIVE");
    });

    it("mounts the documented activity player after the user chooses in-page viewing", () => {
      render(<MatchLiveViewing status="in_progress" commentators={bilibiliCommentators} />);

      fireEvent.click(screen.getByRole("button", { name: "加载站内播放器" }));

      const frame = screen.getByTitle("Bilibili 直播播放器");
      expect(frame).toHaveAttribute("src", getBilibiliEmbedUrl("123456"));
      expect(frame).toHaveAttribute("allow", "autoplay; fullscreen");
    });

    it("renders compact room link during scheduled without auto-expanding iframe", () => {
      const html = renderToStaticMarkup(<MatchLiveViewing status="scheduled" commentators={bilibiliCommentators} />);
      expect(html).toContain("进入直播间");
      expect(html).toContain("解说乙");
      expect(html).not.toContain("加载站内播放器");
    });
  });
});
