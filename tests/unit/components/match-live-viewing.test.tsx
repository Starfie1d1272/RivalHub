import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MatchLiveViewing } from "@/components/matches/MatchLiveViewing";

afterEach(cleanup);
const person = (userId: string, broadcastStatus: "live" | "offline" | "unknown") => ({ userId, displayName: userId, perfectName: null, personaName: null, liveStreamUrl: `https://live.bilibili.com/${userId === "A" ? "1" : "2"}`, broadcastStatus });

it("shows external links for offline and unknown rooms, and no player", () => {
  render(<MatchLiveViewing status="in_progress" commentators={[person("A", "offline"), person("B", "unknown")]} />);
  expect(screen.queryByRole("button", { name: "加载站内播放器" })).toBeNull();
  expect(screen.getByRole("link", { name: /A · 进入直播间/ })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /B · 进入直播间/ })).toBeInTheDocument();
  expect(screen.queryByText("未开播")).toBeNull();
});

it("updates live choices and keeps the selected stream while it remains live", () => {
  const { rerender } = render(<MatchLiveViewing status="scheduled" commentators={[person("A", "live"), person("B", "offline")]} />);
  fireEvent.click(screen.getByRole("button", { name: "加载站内播放器" }));
  expect(screen.getByTitle("Bilibili 直播播放器")).toHaveAttribute("src", expect.stringContaining("cid=1"));
  rerender(<MatchLiveViewing status="in_progress" commentators={[person("A", "live"), person("B", "live")]} />);
  expect(screen.getByTitle("Bilibili 直播播放器")).toHaveAttribute("src", expect.stringContaining("cid=1"));
  fireEvent.click(screen.getByRole("button", { name: "B" }));
  fireEvent.click(screen.getByRole("button", { name: "加载站内播放器" }));
  rerender(<MatchLiveViewing status="in_progress" commentators={[person("A", "offline"), person("B", "live")]} />);
  expect(screen.getByTitle("Bilibili 直播播放器")).toHaveAttribute("src", expect.stringContaining("cid=2"));
  rerender(<MatchLiveViewing status="in_progress" commentators={[person("A", "offline"), person("B", "unknown")]} />);
  expect(screen.queryByTitle("Bilibili 直播播放器")).toBeNull();
});

it("shows the empty state when no room exists", () => {
  render(<MatchLiveViewing status="scheduled" commentators={[]} showEmpty />);
  expect(screen.getByText("暂无直播")).toBeInTheDocument();
});
