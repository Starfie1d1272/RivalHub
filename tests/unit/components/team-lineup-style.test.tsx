import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamLineupStyle } from "@/components/teams/TeamLineupStyle";
import type { LineupStyleMember } from "@/lib/teams/lineup-style";

afterEach(cleanup);
const members: LineupStyleMember[] = Array.from({ length: 3 }, (_, i) => ({
  userId: `player-${i}`, name: ["中文完整昵称", "English Steam Name", "Third Player"][i], avatarUrl: null, maps: 10 - i, rounds: 240 - i,
  attributes: [{ key: "firepower", score: 50, status: "qualified" }, { key: "utility", score: 50, status: i === 2 ? "limited" : "qualified" }],
}));

it("opens touch-safe details, selects coincident members and exposes a separate profile link", async () => {
  const user = userEvent.setup();
  render(<TeamLineupStyle members={members} />);
  expect(screen.getAllByRole("group")).toHaveLength(1);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const plot = screen.getByRole("group", { name: "火力与道具" });
  await user.click(within(plot).getByRole("button", { name: /中文完整昵称/ }));
  expect(screen.getByRole("link", { name: /中文完整昵称/ })).toHaveAttribute("href", "/players/player-0");
  await user.click(screen.getByRole("button", { name: "查看 English Steam Name" }));
  expect(screen.getByRole("link", { name: /English Steam Name/ })).toHaveAttribute("href", "/players/player-1");
  expect(screen.getByText("个人生涯 · 9 Maps")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "查看 Third Player" }));
  expect(screen.getByText("本图部分属性样本有限。")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toContainElement(screen.getByRole("link"));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("does not render empty coordinate systems when all pairs have fewer than three points", () => {
  render(<TeamLineupStyle members={members.slice(0, 2)} />);
  expect(screen.queryByRole("group")).not.toBeInTheDocument();
  expect(screen.getByText("暂无可用阵容画像。")).toBeInTheDocument();
});

it("closes the floating card on an outside click and reopens it on keyboard focus", async () => {
  const user = userEvent.setup();
  render(<><button>页面其它操作</button><TeamLineupStyle members={members} /></>);
  const point = within(screen.getByRole("group", { name: "火力与道具" })).getByRole("button", { name: /中文完整昵称/ });
  await user.click(point);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "页面其它操作" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.tab();
  expect(point).toHaveFocus();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
