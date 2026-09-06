/** @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VetoInputDialog } from "@/components/matches/VetoInputDialog";

const { getMatchVetoStepsMock, saveVetoStepsMock } = vi.hoisted(() => ({
  getMatchVetoStepsMock: vi.fn(),
  saveVetoStepsMock: vi.fn(),
}));

vi.mock("@/actions/matches/veto", () => ({
  getMatchVetoSteps: getMatchVetoStepsMock,
  saveVetoSteps: saveVetoStepsMock,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const MAP_POOL = [
  "de_ancient",
  "de_anubis",
  "de_dust2",
  "de_inferno",
  "de_mirage",
  "de_nuke",
  "de_overpass",
];

type DialogProps = React.ComponentProps<typeof VetoInputDialog>;

const BASE_PROPS = {
  matchId: "match-1",
  format: "bo3" as DialogProps["format"],
  teamAName: "Alpha",
  teamBName: "Beta",
  entryAId: "entry-a",
  entryBId: "entry-b",
  mapPool: MAP_POOL,
};

const EXISTING_STEPS = [
  { actionType: "ban", mapName: "de_ancient", entryId: "entry-a", side: null },
  { actionType: "ban", mapName: "de_anubis", entryId: "entry-b", side: null },
  { actionType: "pick", mapName: "de_dust2", entryId: "entry-a", side: null },
  { actionType: "pick", mapName: "de_inferno", entryId: "entry-b", side: null },
  { actionType: "ban", mapName: "de_mirage", entryId: "entry-b", side: null },
  { actionType: "ban", mapName: "de_nuke", entryId: "entry-a", side: null },
  { actionType: "decider", mapName: "de_overpass", entryId: "entry-b", side: null },
];

function renderDialog(props: Partial<DialogProps> = {}) {
  return render(<VetoInputDialog {...BASE_PROPS} {...props} />);
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "录入 BP" }));
}

beforeEach(() => {
  getMatchVetoStepsMock.mockReset();
  saveVetoStepsMock.mockReset();
});

describe("VetoInputDialog load state and responsive contract", () => {
  it("keeps the loading state read-only until the server read completes", async () => {
    let resolveRead!: (steps: never[]) => void;
    getMatchVetoStepsMock.mockReturnValue(new Promise<never[]>((resolve) => {
      resolveRead = resolve;
    }));

    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    expect(screen.getByRole("status")).toHaveTextContent("正在读取已保存的 BP");
    expect(screen.getByRole("button", { name: "保存 BP" })).toBeDisabled();
    expect(screen.queryAllByTestId("veto-step")).toHaveLength(0);

    resolveRead([]);
    await waitFor(() => expect(screen.getByText("尚未录入 BP，可按模板开始。")).toBeInTheDocument());
  });

  it("fails closed on a read error and only exposes the template after a successful retry", async () => {
    getMatchVetoStepsMock
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce([]);

    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("BP 读取失败");
    expect(error).toHaveTextContent("为避免覆盖未知服务器状态，请先成功读取");
    expect(screen.getByRole("button", { name: "保存 BP" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重置模板" })).toBeDisabled();
    expect(screen.queryAllByTestId("veto-step")).toHaveLength(0);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "重试读取" }));

    await waitFor(() => expect(screen.getByText("尚未录入 BP，可按模板开始。")).toBeInTheDocument());
    expect(screen.getByTestId("veto-load-state")).toHaveAttribute("data-veto-load-state", "loaded-empty");
    expect(screen.getAllByTestId("veto-step")).toHaveLength(7);
    expect(screen.getByRole("button", { name: "保存 BP" })).not.toBeDisabled();
    expect(saveVetoStepsMock).not.toHaveBeenCalled();
    expect(getMatchVetoStepsMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the existing-BP path editable and saves the confirmed server state", async () => {
    getMatchVetoStepsMock.mockResolvedValue(EXISTING_STEPS);
    saveVetoStepsMock.mockResolvedValue({ success: true, data: undefined });

    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    await waitFor(() => expect(screen.getByText("已加载已保存的 BP，可直接编辑。")).toBeInTheDocument());
    expect(screen.getByTestId("veto-load-state")).toHaveAttribute("data-veto-load-state", "loaded-existing");
    expect(screen.getAllByTestId("veto-step")).toHaveLength(EXISTING_STEPS.length);

    await user.click(screen.getByRole("button", { name: "保存 BP" }));

    await waitFor(() => expect(saveVetoStepsMock).toHaveBeenCalledWith("match-1", { steps: EXISTING_STEPS }));
  });

  it.each(["bo1", "bo3", "bo5"] as const)(
    "keeps every %s step accessible in the 320px/390px narrow layout contract",
    async (format) => {
      getMatchVetoStepsMock.mockResolvedValue([]);

      for (const viewport of [320, 390]) {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: viewport });
        const user = userEvent.setup();
        const { unmount } = renderDialog({ format });
        await openDialog(user);
        await waitFor(() => expect(screen.getAllByTestId("veto-step")).toHaveLength(7));

        const body = screen.getByTestId("veto-load-state");
        expect(body).toHaveClass("min-w-0", "overflow-x-hidden");
        for (const step of screen.getAllByTestId("veto-step")) {
          expect(step.className).toContain("grid-cols-[auto_minmax(0,1fr)]");
          expect(step).toHaveClass("min-w-0", "sm:flex");
          const mapSelect = within(step).getAllByRole("combobox")[0]!;
          expect(mapSelect.parentElement).toHaveClass("min-w-0", "sm:flex-1");
        }
        const saveButton = screen.getByRole("button", { name: "保存 BP" });
        expect(body).not.toContainElement(saveButton);
        expect(screen.getByRole("dialog")).toContainElement(saveButton);
        unmount();
      }
    },
  );

  it("wraps a long side-selection explanation without displacing its select", async () => {
    const longTeamName = "超长战队名称".repeat(12);
    getMatchVetoStepsMock.mockResolvedValue(EXISTING_STEPS);

    const user = userEvent.setup();
    renderDialog({ teamBName: longTeamName });
    await openDialog(user);

    await waitFor(() => expect(screen.getByText("已加载已保存的 BP，可直接编辑。")).toBeInTheDocument());
    const sideLabel = screen.getByText(`→ ${longTeamName}选边`);
    expect(sideLabel).toHaveClass("min-w-0", "flex-1", "break-words");
    expect(sideLabel.parentElement).toHaveClass("min-w-0", "flex-wrap");
  });
});
