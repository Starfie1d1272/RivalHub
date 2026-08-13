/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveSeason,
  createSeason,
  deleteSeason,
  forceFinishSeason,
  publishSeason,
  revertSeasonToDraft,
  revertSeasonToRegistration,
} from "@/actions/seasons";
import { SeasonForm } from "@/components/admin/SeasonForm";
import {
  RIVALS_DEFAULT_CAPABILITIES,
  createMajorDefaultCapabilities,
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
const archiveSeasonMock = vi.mocked(archiveSeason);
const deleteSeasonMock = vi.mocked(deleteSeason);
const forceFinishSeasonMock = vi.mocked(forceFinishSeason);
const publishSeasonMock = vi.mocked(publishSeason);
const revertSeasonToDraftMock = vi.mocked(revertSeasonToDraft);
const revertSeasonToRegistrationMock = vi.mocked(revertSeasonToRegistration);

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
    const successWithSlug = { success: true as const, data: { slug: "test-season" } };
    archiveSeasonMock.mockResolvedValue(successWithSlug);
    deleteSeasonMock.mockResolvedValue({ success: true, data: undefined });
    forceFinishSeasonMock.mockResolvedValue(successWithSlug);
    publishSeasonMock.mockResolvedValue(successWithSlug);
    revertSeasonToDraftMock.mockResolvedValue(successWithSlug);
    revertSeasonToRegistrationMock.mockResolvedValue(successWithSlug);
  });

  it("does not show Major status in a Rivals display context", () => {
    render(<SeasonForm mode="create" initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "选秀联赛")} />);

    expect(screen.queryByText(/标准 Major 摘要|当前配置已偏离标准 Major/)).not.toBeInTheDocument();
  });

  it("resets the registration total after applying Major then Rivals", async () => {
    const user = userEvent.setup();
    render(<SeasonForm mode="create" initial={createInitial(createMajorDefaultCapabilities(), "Major")} />);

    await user.click(screen.getByRole("button", { name: "Major 公开赛" }));
    await user.click(screen.getByRole("button", { name: "Rivals 选秀联赛" }));
    await user.click(screen.getByRole("button", { name: "创建赛季" }));

    await waitFor(() => {
      expect(createSeasonMock).toHaveBeenCalledWith(expect.objectContaining({
        registrationConfig: expect.objectContaining({ maxTotal: 56 }),
      }));
    });
  });

  it("keeps existing season lifecycle controls callable", async () => {
    const user = userEvent.setup();
    const capabilities = createMajorDefaultCapabilities();
    const cases = [
      { status: "draft" as const, label: "删除赛季", mock: deleteSeasonMock },
      { status: "registration" as const, label: "撤回至草稿", mock: revertSeasonToDraftMock },
      { status: "voting" as const, label: "撤回至报名阶段", mock: revertSeasonToRegistrationMock },
      { status: "playing" as const, label: "手动结束赛季", mock: forceFinishSeasonMock },
      { status: "finished" as const, label: "归档赛季", mock: archiveSeasonMock },
    ];

    for (const { status, label, mock } of cases) {
      const view = render(<SeasonForm mode="edit" initial={createInitial(capabilities, "Major", status)} />);
      await user.click(screen.getByRole("button", { name: label }));
      await waitFor(() => expect(mock).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111"));
      if (status === "draft") {
        await user.click(screen.getByRole("button", { name: "发布赛季" }));
        await waitFor(() => expect(publishSeasonMock).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111"));
      }
      view.unmount();
    }
  });
});
