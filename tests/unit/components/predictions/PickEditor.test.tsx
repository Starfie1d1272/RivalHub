import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PickEditor, emptyPick } from "@/components/predictions/PickEditor";
import type { PredictionBoardData } from "@/lib/predictions/data";
import type { Pick } from "@/lib/predictions/types";
import { DEFAULT_RULES } from "@/lib/predictions/rules";

type Contest = PredictionBoardData["contests"][number];
const teams = Array.from({ length: 16 }, (_, i) => ({
  teamId: `t${i + 1}`,
  name: `队${i + 1}`,
  logoUrl: null,
  tournamentSeed: i + 1,
}));
const contest: Contest = {
  id: "contest",
  stageKey: "playoff",
  kind: "single_elim",
  entrants: teams
    .slice(0, 8)
    .map((t) => ({ teamId: t.teamId, seed: t.tournamentSeed })),
  quarterfinals: [
    ["t1", "t8"],
    ["t4", "t5"],
    ["t2", "t7"],
    ["t3", "t6"],
  ],
  deadline: "2030-01-01T00:00:00Z",
  locked: false,
  voidReason: null,
  submitted: null,
  draft: null,
  judgementRevisions: 0,
};
// The component consumes only this public DTO subset; no persistence owner is mocked.
const data = {
  base: { teams },
  rules: DEFAULT_RULES,
  joined: true,
  paused: false,
} as PredictionBoardData;
function Harness({
  window = contest,
  initial = emptyPick(window.kind),
  save = vi.fn(),
}: {
  window?: Contest;
  initial?: Pick;
  save?: (submitted: boolean) => void;
}) {
  const [pick, setPick] = useState(initial);
  return (
    <PickEditor
      data={data}
      contest={window}
      pick={pick}
      onChange={setPick}
      onSave={save}
      onExport={vi.fn()}
      busy={false}
    />
  );
}

describe("independent Pick’Em slots and bracket", () => {
  it("clears only the affected playoff descendants, preserving the other semifinal", () => {
    const save = vi.fn();
    render(
      <Harness
        save={save}
        initial={{ bracket: ["t1", "t4", "t2", "t3", "t1", "t2", "t1"] }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "八强 1：队8" }));
    expect(
      screen.getByRole("button", { name: "半决赛 1：队8" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "半决赛 2：队2" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "冠军：待选择" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "提交预测" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "半决赛 1：队8" }));
    fireEvent.click(screen.getByRole("button", { name: "冠军：队8" }));
    expect(screen.getByText("已填写 7/7")).toBeVisible();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "提交预测" }));
    expect(save).toHaveBeenCalledWith(true);
  });
  it("moves an existing Swiss team without duplicating it and does not submit a draft", () => {
    const save = vi.fn();
    render(
      <Harness
        save={save}
        window={{
          ...contest,
          kind: "swiss",
          entrants: teams.map((t) => ({
            teamId: t.teamId,
            seed: t.tournamentSeed,
          })),
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "选择 队1" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "恰好 3胜0负 1：待选择",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "3胜1负 / 3胜2负 1：待选择",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "选择 队1" }));
    expect(
      screen.getByRole("button", {
        name: "恰好 3胜0负 1：待选择",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "3胜1负 / 3胜2负 1：队1",
      }),
    ).toBeVisible();
    expect(screen.getByText("已填写 1/10")).toBeVisible();
    expect(save).not.toHaveBeenCalled();
  });
  it("prevents all pick changes after the contest locks", () => {
    render(<Harness window={{ ...contest, locked: true }} />);
    expect(screen.getByRole("button", { name: "八强 1：队1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "导出图片" })).toBeEnabled();
  });
});
