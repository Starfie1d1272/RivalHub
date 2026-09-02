/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSeason, deleteSeason } from "@/actions/seasons";
import { SeasonForm } from "@/components/admin/SeasonForm";
import {
  RIVALS_DEFAULT_CAPABILITIES,
  type SeasonCapabilities,
} from "@/types/season";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/actions/seasons", () => ({
  createSeason: vi.fn(),
  deleteSeason: vi.fn(),
  publishSeason: vi.fn(),
  updateSeason: vi.fn(),
  revertSeasonToDraft: vi.fn(),
  revertSeasonToRegistration: vi.fn(),
  forceFinishSeason: vi.fn(),
  archiveSeason: vi.fn(),
}));

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const SelectContext = React.createContext<((value: string) => void) | undefined>(undefined);

  return {
    Select: ({ children, onValueChange }: { children: React.ReactNode; onValueChange?: (value: string) => void }) =>
      React.createElement(SelectContext.Provider, { value: onValueChange }, children),
    SelectContent: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => {
      const onValueChange = React.useContext(SelectContext);
      return React.createElement("button", { type: "button", onClick: () => onValueChange?.(value) }, children);
    },
    SelectTrigger: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
    SelectValue: ({ placeholder }: { placeholder?: string }) => React.createElement("span", null, placeholder),
  };
});

const createSeasonMock = vi.mocked(createSeason);
const deleteSeasonMock = vi.mocked(deleteSeason);

function createInitial(
  capabilities: SeasonCapabilities,
  kind: string,
  status: "draft" | "registration" | "voting" | "playing" | "finished" = "draft",
) {
  return {
    ...capabilities,
    id: "11111111-1111-4111-8111-111111111111",
    name: "测试赛事",
    slug: "test-season",
    kind,
    status,
    template: "rivals" as const,
    themeColor: "#f97316",
    registrationOpensAt: null,
    registrationClosesAt: null,
    rosterChangeClosesAt: null,
    endAt: null,
  };
}

describe("SeasonForm presets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    vi.stubGlobal("confirm", vi.fn(() => true));
    createSeasonMock.mockResolvedValue({
      success: true,
      data: { seasonId: "11111111-1111-4111-8111-111111111111", slug: "test-season" },
    });
    deleteSeasonMock.mockResolvedValue({ success: true, data: undefined });
  });

  it("does not show Major status in a Rivals display context", () => {
    render(<SeasonForm mode="create" competitivePlatforms={[{ key: "perfect_world", displayName: "完美世界竞技平台" }]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "选秀联赛")} />);

    expect(screen.queryByText(/标准 Major 摘要|当前配置已偏离标准 Major/)).not.toBeInTheDocument();
  });

  it("resets the registration total after applying Major then Rivals; built-in team size controls are fixed", async () => {
    const user = userEvent.setup();
    render(<SeasonForm mode="create" competitivePlatforms={[{ key: "perfect_world", displayName: "完美世界竞技平台" }]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "选秀联赛")} />);

    // Built-in templates fix team size on the server, so the inputs are disabled.
    expect(screen.getByLabelText("每队人数上限")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Major" }));
    await user.click(screen.getByRole("button", { name: "Rivals" }));
    await user.click(screen.getByRole("button", { name: "保存为草稿" }));

    await waitFor(() => {
      expect(createSeasonMock).toHaveBeenCalledWith(expect.objectContaining({
        registrationConfig: expect.objectContaining({
          maxPerPosition: 15,
          maxTotal: 56,
          mapPool: RIVALS_DEFAULT_CAPABILITIES.registrationConfig.mapPool,
          screenshotCount: 1,
        }),
      }));
    });
  });

  it("requires an in-app confirmation before deleting a draft season", async () => {
    const user = userEvent.setup();
    render(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "选秀联赛")} />);

    await user.click(screen.getByRole("button", { name: "删除赛季" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("确认删除这个草稿赛季？");
    expect(deleteSeasonMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "删除赛季" }));
    await waitFor(() => expect(deleteSeasonMock).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111"));
  });

});
