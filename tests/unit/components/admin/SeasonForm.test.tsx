/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSeason } from "@/actions/seasons";
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
    themeColor: "#f97316",
    startAt: null,
    registrationDeadline: null,
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
  });

  it("does not show Major status in a Rivals display context", () => {
    render(<SeasonForm mode="create" initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "选秀联赛")} />);

    expect(screen.queryByText(/标准 Major 摘要|当前配置已偏离标准 Major/)).not.toBeInTheDocument();
  });

  it("resets the registration total after applying Major then Rivals", async () => {
    const user = userEvent.setup();
    render(<SeasonForm mode="create" initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "选秀联赛")} />);

    await user.clear(screen.getByLabelText("位置列表"));
    await user.type(screen.getByLabelText("位置列表"), "custom");
    await user.clear(screen.getByLabelText("每队人数上限"));
    await user.type(screen.getByLabelText("每队人数上限"), "8");
    await user.clear(screen.getByLabelText("每队人数下限"));
    await user.type(screen.getByLabelText("每队人数下限"), "4");
    await user.clear(screen.getByLabelText("每位置上限"));
    await user.type(screen.getByLabelText("每位置上限"), "3");
    await user.clear(screen.getByLabelText("截图链接数量"));
    await user.type(screen.getByLabelText("截图链接数量"), "2");
    await user.clear(screen.getByLabelText("比赛图池"));
    await user.type(screen.getByLabelText("比赛图池"), "de_custom");

    await user.click(screen.getByRole("button", { name: "Major 公开赛" }));
    await user.click(screen.getByRole("button", { name: "Rivals 选秀联赛" }));
    await user.click(screen.getByRole("button", { name: "创建赛季" }));

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

});
