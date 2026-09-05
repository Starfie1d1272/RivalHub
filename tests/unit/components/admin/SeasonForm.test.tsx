/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSeason, deleteSeason, updateSeason } from "@/actions/seasons";
import { SeasonForm } from "@/components/admin/SeasonForm";
import {
  RIVALS_DEFAULT_CAPABILITIES,
  MAJOR_DEFAULT_CAPABILITIES,
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
  const SelectContext = React.createContext<{ onValueChange?: (value: string) => void; disabled: boolean }>({ disabled: false });

  return {
    Select: ({ children, onValueChange, disabled = false }: { children: React.ReactNode; onValueChange?: (value: string) => void; disabled?: boolean }) =>
      React.createElement(SelectContext.Provider, { value: { onValueChange, disabled } }, children),
    SelectContent: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ children, value, disabled = false }: { children: React.ReactNode; value: string; disabled?: boolean }) => {
      const context = React.useContext(SelectContext);
      return React.createElement("button", { type: "button", disabled: disabled || context.disabled, onClick: () => context.onValueChange?.(value) }, children);
    },
    SelectTrigger: ({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) => React.createElement("div", { "aria-disabled": disabled }, children),
    SelectValue: ({ placeholder }: { placeholder?: string }) => React.createElement("span", null, placeholder),
  };
});

const createSeasonMock = vi.mocked(createSeason);
const deleteSeasonMock = vi.mocked(deleteSeason);
const updateSeasonMock = vi.mocked(updateSeason);

function createInitial(
  capabilities: SeasonCapabilities,
  kind: string,
  status: "draft" | "registration" | "voting" | "playing" | "finished" | "archived" = "draft",
  overrides: Record<string, unknown> = {},
) {
  return {
    ...capabilities,
    id: "11111111-1111-4111-8111-111111111111",
    name: "Test Season",
    slug: "test-season",
    kind,
    status,
    template: "rivals" as const,
    themeColor: "#f97316",
    registrationOpensAt: null,
    registrationOpenedAt: null,
    registrationClosesAt: null,
    rosterChangeClosesAt: null,
    endAt: null,
    ...overrides,
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
    updateSeasonMock.mockResolvedValue({ success: true, data: { slug: "updated-season" } });
  });

  it("does not show Major status in a Rivals display context", () => {
    render(<SeasonForm mode="create" competitivePlatforms={[{ key: "perfect_world", displayName: "完美世界竞技平台" }]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "选秀联赛")} />);

    expect(screen.queryByText(/标准 Major 摘要|当前配置已偏离标准 Major/)).not.toBeInTheDocument();
  });

  it("defaults community awards on and submits a draft capability toggle", async () => {
    const user = userEvent.setup();
    render(<SeasonForm mode="create" competitivePlatforms={[]} initial={createInitial(structuredClone(MAJOR_DEFAULT_CAPABILITIES), "Major")} />);

    const toggle = screen.getByRole("checkbox", { name: "社区奖" });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "保存为草稿" }));

    await waitFor(() => expect(createSeasonMock).toHaveBeenCalledWith(expect.objectContaining({ hasCommunityAwards: false })));
  });

  it("locks the community-awards capability after publish", () => {
    render(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(MAJOR_DEFAULT_CAPABILITIES), "Major", "registration", { template: "major", hasCommunityAwards: false })} />);

    const toggle = screen.getByRole("checkbox", { name: "社区奖" });
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeDisabled();
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

  it("shows the standard Major's policy-driven 5E fallback note without a hand-entered mapping", () => {
    const initial = { ...createInitial(structuredClone(MAJOR_DEFAULT_CAPABILITIES), "Major"), template: "major" as const };
    render(<SeasonForm mode="create" competitivePlatforms={[
      { key: "perfect_world", displayName: "Perfect World", seasons: [{ seasonKey: "s21", label: "S21", active: true }], ranks: [{ rankKey: "A", label: "A" }] },
      { key: "fivee", displayName: "5E", seasons: [{ seasonKey: "5e-s21", label: "S21", active: true }], ranks: [{ rankKey: "S", label: "S" }] },
    ]} initial={initial} />);

    expect(screen.getByText(/当前已批准的 5E/)).toBeInTheDocument();
    expect(screen.queryByText("允许审核过的 5E 竞技资料等效补充")).not.toBeInTheDocument();
    expect(screen.queryByText("队伍管理")).not.toBeInTheDocument();
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

  it("keeps a create slug in sync with the full name until it is manually edited", async () => {
    const user = userEvent.setup();
    render(<SeasonForm mode="create" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛", "draft", { name: "", slug: "" })} />);

    const name = screen.getByLabelText("名称");
    const slug = screen.getByLabelText("Slug");
    await user.type(name, "2026");
    await waitFor(() => expect(slug).toHaveValue("2026"));
    await user.type(name, " NJU Major");
    await waitFor(() => expect(slug).toHaveValue("2026-nju-major"));
  });

  it("stops following the name after the operator edits the create slug", async () => {
    const user = userEvent.setup();
    render(<SeasonForm mode="create" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛", "draft", { name: "", slug: "" })} />);

    const name = screen.getByLabelText("名称");
    const slug = screen.getByLabelText("Slug");
    await user.type(name, "2026");
    await waitFor(() => expect(slug).toHaveValue("2026"));
    await user.clear(slug);
    await user.type(slug, "manual-event");
    await user.clear(name);
    await user.type(name, "2026 NJU Major");
    expect(slug).toHaveValue("manual-event");
  });

  it("requires a manual slug for a name that has no ASCII slug", async () => {
    render(<SeasonForm mode="create" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛", "draft", { name: "", slug: "" })} />);

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "南京大学秋季赛" } });
    await waitFor(() => {
      expect(screen.getByLabelText("Slug")).toHaveValue("");
      expect(screen.getByText("URL 标识无法从当前名称自动生成，请填写小写字母、数字或连字符。")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "保存为草稿" })).toBeDisabled();
    expect(createSeasonMock).not.toHaveBeenCalled();
  });

  it("allows draft slug edits but locks a published slug", () => {
    const { rerender } = render(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛")} />);
    expect(screen.getByLabelText("Slug")).toBeEnabled();

    rerender(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛", "registration")} />);
    expect(screen.getByLabelText("Slug")).toBeDisabled();
  });

  it("allows a draft template switch and keeps a published template read-only", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛")} />);
    await user.click(screen.getByRole("button", { name: "Major" }));
    await user.click(screen.getByRole("button", { name: "确认" }));
    expect(screen.getByRole("heading", { name: "竞技参考" })).toBeInTheDocument();

    rerender(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(MAJOR_DEFAULT_CAPABILITIES), "Major", "registration", { template: "major" })} />);
    expect(screen.getByDisplayValue("Major")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Major" })).not.toBeInTheDocument();
  });

  it("organizes edit settings into the agreed presentation sections", () => {
    render(<SeasonForm mode="edit" competitivePlatforms={[{ key: "perfect_world", displayName: "完美世界竞技平台" }]} initial={createInitial(structuredClone(MAJOR_DEFAULT_CAPABILITIES), "Major")} />);

    for (const section of ["基本信息", "时间与生命周期", "报名与名单", "资格规则", "赛制与地图", "竞技参考", "功能", "危险操作"]) {
      expect(screen.getByRole("heading", { name: section })).toBeInTheDocument();
    }
    expect(screen.getByText(/5E → 完美世界竞技平台 · ConversionPolicy 尚未绑定/)).toBeInTheDocument();
  });

  it("shows the frozen ConversionPolicy identity after registration opens", () => {
    const initial = createInitial(structuredClone(MAJOR_DEFAULT_CAPABILITIES), "Major", "registration", {
      template: "major",
      registrationOpenedAt: new Date("2026-09-01T00:00:00.000Z"),
      teamRegistrationConfig: {
        ...structuredClone(MAJOR_DEFAULT_CAPABILITIES.teamRegistrationConfig),
        competitiveProfile: {
          ...structuredClone(MAJOR_DEFAULT_CAPABILITIES.teamRegistrationConfig.competitiveProfile!),
          currentSeasonKey: "perfect-2026",
          previousSeasonKey: "perfect-2025",
          rankOrder: ["A", "S"],
          evidencePolicy: {
            historicalWeight: 50,
            referenceSeasonKey: "perfect-2025",
            referenceSeasonWeight: 20,
            recentSeasonKeys: ["perfect-2025", "perfect-2026"],
            recentSeasonWeight: 30,
          },
          conversionPolicyId: "policy-2026-09",
          conversionPolicyVersion: "2026.09",
          fallbackConversion: {
            sourcePlatform: "fivee",
            version: "2026.09",
            seasonKeyMap: { "perfect-2026": "fivee-2026" },
          },
        },
      },
    });

    render(<SeasonForm
      mode="edit"
      competitivePlatforms={[{
        key: "perfect_world",
        displayName: "完美世界竞技平台",
        seasons: [
          { seasonKey: "perfect-2025", label: "2025 完整赛季", active: false },
          { seasonKey: "perfect-2026", label: "2026 赛季", active: true },
        ],
      }]}
      initial={initial}
    />);

    expect(screen.getByText(/ConversionPolicy 2026\.09/)).toBeInTheDocument();
    expect(screen.getByText("本届已在报名开放时冻结；全局 policy 后续变化不会影响本届。")).toBeInTheDocument();
    expect(screen.getByText("策略 ID：policy-2026-09")).toBeInTheDocument();
  });

  it("keeps status-specific lifecycle actions in the settings sections", () => {
    const { rerender } = render(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛", "draft")} />);
    expect(screen.getByRole("button", { name: "发布赛季" })).toBeInTheDocument();

    rerender(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛", "registration")} />);
    expect(screen.getByRole("button", { name: "立即开放报名" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤回至草稿" })).toBeInTheDocument();

    rerender(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛", "voting")} />);
    expect(screen.getByRole("button", { name: "撤回至报名阶段" })).toBeInTheDocument();

    rerender(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛", "playing")} />);
    expect(screen.getByRole("button", { name: "手动结束赛季" })).toBeInTheDocument();

    rerender(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛", "finished")} />);
    expect(screen.getByRole("button", { name: "归档赛季" })).toBeInTheDocument();

    rerender(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛", "archived")} />);
    expect(screen.getByText("当前状态没有可用的危险操作。")).toBeInTheDocument();
    expect(screen.getByTestId("season-lifecycle-explanation")).toHaveTextContent("赛事已结束");
  });

  it("locks custom public registration controls after publish", () => {
    render(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛", "registration", { template: "custom" })} />);

    expect(screen.getByLabelText("每位置上限")).toBeDisabled();
    expect(screen.getByLabelText("截图链接数量")).toBeDisabled();
    expect(screen.getByLabelText("在校")).toBeDisabled();
  });

  it("passes the published public-rule capability to custom team configuration", () => {
    render(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(MAJOR_DEFAULT_CAPABILITIES), "公开赛", "registration", { template: "custom" })} />);

    expect(screen.getByLabelText("队长可转让")).toBeDisabled();
    expect(screen.getByLabelText("队伍名必须唯一")).toBeDisabled();
  });

  it("keeps registration deadlines operational before and after opening, then locks them at playing", () => {
    const { rerender } = render(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛", "registration", { registrationOpenedAt: new Date("2026-05-01T00:00:00.000Z") })} />);
    expect(screen.getByLabelText("报名开放时间")).toBeDisabled();
    expect(screen.getByLabelText("报名截止时间")).toBeEnabled();
    expect(screen.getByLabelText("名单调整截止时间")).toBeEnabled();

    rerender(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛", "playing", { registrationOpenedAt: new Date("2026-05-01T00:00:00.000Z") })} />);
    expect(screen.getByLabelText("报名截止时间")).toBeDisabled();
    expect(screen.getByLabelText("名单调整截止时间")).toBeDisabled();
  });

  it("explains each lifecycle edit boundary", () => {
    const { rerender } = render(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛")} />);
    expect(screen.getByTestId("season-lifecycle-explanation")).toHaveTextContent("所有赛事定义仍可调整");

    rerender(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛", "registration")} />);
    expect(screen.getByTestId("season-lifecycle-explanation")).toHaveTextContent("公开赛事规则已锁定");

    rerender(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛", "registration", { registrationOpenedAt: new Date("2026-05-01T00:00:00.000Z") })} />);
    expect(screen.getByTestId("season-lifecycle-explanation")).toHaveTextContent("竞技上下文、5E fallback 和实际开放时间已冻结");

    rerender(<SeasonForm mode="edit" competitivePlatforms={[]} initial={createInitial(structuredClone(RIVALS_DEFAULT_CAPABILITIES), "公开赛", "playing", { registrationOpenedAt: new Date("2026-05-01T00:00:00.000Z") })} />);
    expect(screen.getByTestId("season-lifecycle-explanation")).toHaveTextContent("比赛已开始");
  });

});
