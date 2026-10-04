import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EventSelector } from "./EventSelector";
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
describe("bounded event selection", () => {
  it("searches without navigating, confirms with keyboard and returns focus on Escape", async () => {
    const user = userEvent.setup();
    render(<EventSelector events={[{ slug: "history", name: "已归档长名称赛事", status: "archived" }, { slug: "current", name: "当前赛事", status: "playing" }]} value="current" allHref="/stats" hrefFor={(slug) => `/stats?event=${slug}`} />);
    const trigger = screen.getByRole("button", { name: "选择赛事" });
    await user.click(trigger);
    await user.type(screen.getByLabelText("搜索名称或 slug"), "history");
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(router.push).toHaveBeenCalledWith("/stats?event=history");
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });
  it("has an explicit no-match state and independently confirms all-public", async () => {
    const user = userEvent.setup();
    render(<EventSelector events={[]} value="" allHref="/stats" hrefFor={(slug) => `/${slug}`} />);
    await user.click(screen.getByRole("button", { name: "选择赛事" }));
    await user.type(screen.getByLabelText("搜索名称或 slug"), "missing");
    expect(screen.getByRole("status")).toHaveTextContent("没有匹配的公开赛事");
    await user.clear(screen.getByLabelText("搜索名称或 slug"));
    await user.click(screen.getByRole("option"));
    expect(router.push).toHaveBeenCalledWith("/stats");
  });
});
