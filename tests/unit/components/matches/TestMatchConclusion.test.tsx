/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { concludeTestMatch } from "@/actions/test-matches";
import { TestMatchConclusion } from "@/components/matches/TestMatchConclusion";
vi.mock("@/actions/test-matches", () => ({ concludeTestMatch: vi.fn(async () => ({ success: true })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
it("sends edited map facts, final score and review metadata together", async () => {
  const updatedAt = "2026-10-08T00:00:00.000Z";
  render(<TestMatchConclusion matchId="match" finished disposition="recorded" updatedAt={updatedAt} scoreA={2} scoreB={0}
    maps={[{ id: "map1", mapName: "de_mirage", scoreA: 13, scoreB: 9 }, { id: "map2", mapName: "de_nuke", scoreA: 13, scoreB: 9 }]} />);
  expect(screen.getByLabelText("A 方胜场")).toHaveValue(2);
  fireEvent.change(screen.getByLabelText("A 方胜场"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("B 方胜场"), { target: { value: "2" } });
  for (const input of screen.getAllByLabelText(/A 方回合数/)) fireEvent.change(input, { target: { value: "9" } });
  for (const input of screen.getAllByLabelText(/B 方回合数/)) fireEvent.change(input, { target: { value: "13" } });
  fireEvent.change(screen.getByLabelText("更正原因"), { target: { value: "比分录反" } });
  fireEvent.click(screen.getByRole("button", { name: "保存结果更正" }));
  fireEvent.click(screen.getByRole("button", { name: /^确认$/ }));
  await waitFor(() => expect(concludeTestMatch).toHaveBeenCalledWith("match", { kind: "recorded", scoreA: 0, scoreB: 2 }, {
    expectedUpdatedAt: updatedAt, reason: "比分录反", maps: [{ mapId: "map1", scoreA: 9, scoreB: 13 }, { mapId: "map2", scoreA: 9, scoreB: 13 }],
  }));
});

it("keeps all conclusion choices while the match is in progress", () => {
  render(<TestMatchConclusion matchId="match" finished={false} disposition={null} updatedAt="now" scoreA={null} scoreB={null} maps={[]} />);
  expect(screen.getByRole("button", { name: "不提交结果" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "结束，结果待补" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "提交总比分" })).toBeEnabled();
});
it.each(["pending", "recorded", "omitted", null] as const)("finished %s hides conclusion actions and keeps recording", (disposition) => {
  render(<TestMatchConclusion matchId="match" finished disposition={disposition} updatedAt="now" scoreA={null} scoreB={null} maps={[]} />);
  expect(screen.queryByRole("button", { name: "不提交结果" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "结束，结果待补" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: disposition === "pending" ? "提交总比分" : "保存结果更正" })).toBeEnabled();
});
it("still submits pending-result backfill without a correction envelope", async () => {
  vi.mocked(concludeTestMatch).mockClear();
  render(<TestMatchConclusion matchId="backfill" finished disposition="pending" updatedAt="now" scoreA={null} scoreB={null} maps={[]} />);
  fireEvent.change(screen.getByLabelText("A 方胜场"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "提交总比分" }));
  fireEvent.click(screen.getByRole("button", { name: /^确认$/ }));
  await waitFor(() => expect(concludeTestMatch).toHaveBeenCalledWith("backfill", { kind: "recorded", scoreA: 1, scoreB: 0 }, undefined));
});
