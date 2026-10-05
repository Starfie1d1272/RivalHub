import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { parseStatsQuery } from "@/lib/stats/view-state";
import { StatsEventSelector } from "./StatsEventSelector";
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const events = [{ slug: "first", name: "第一届", status: "playing", maps: ["de_ancient"] },
  { slug: "next", name: "下一届", status: "archived", maps: ["de_ancient"] }];
it("clears map detail and stage but preserves its compatible map scope on event change", async () => {
  const user = userEvent.setup();
  render(<StatsEventSelector events={events} value="first" query={parseStatsQuery({ tab: "maps", map: "de_ancient", stage: "swiss", format: "bo3" }, ["swiss"])} />);
  await user.click(screen.getByRole("button", { name: "选择赛事" }));
  await user.click(await screen.findByRole("option", { name: /下一届/ }));
  expect(router.push).toHaveBeenLastCalledWith("/stats?tab=maps&format=bo3&mapFilter=de_ancient&event=next");
});
it("resets bounded tie pagination when changing event", async () => {
  const user = userEvent.setup();
  render(<StatsEventSelector events={events} value="first" query={{ ...parseStatsQuery({ tab: "records" }, []), recordPage: 3 }} />);
  await user.click(screen.getByRole("button", { name: "选择赛事" }));
  await user.click(await screen.findByRole("option", { name: /下一届/ }));
  expect(router.push).toHaveBeenLastCalledWith("/stats?tab=records&event=next");
});
