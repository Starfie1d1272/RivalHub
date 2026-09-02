/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CompetitivePlatformCatalog } from "@/components/admin/CompetitivePlatformCatalog";
import {
  createCompetitivePlatformRank,
  createCompetitivePlatformSeason,
  deleteCompetitivePlatformRank,
  setCurrentCompetitivePlatformSeason,
  updateCompetitivePlatform,
} from "@/actions/competitive-platform";

const { refreshMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({ refreshMock: vi.fn(), toastSuccessMock: vi.fn(), toastErrorMock: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));
vi.mock("@/actions/competitive-platform", () => ({
  createCompetitivePlatformRank: vi.fn(), createCompetitivePlatformSeason: vi.fn(),
  deleteCompetitivePlatformRank: vi.fn(), deleteCompetitivePlatformSeason: vi.fn(), moveCompetitivePlatformRank: vi.fn(),
  moveCompetitivePlatformSeason: vi.fn(), setCurrentCompetitivePlatformSeason: vi.fn(), setCompetitivePlatformSeasonActive: vi.fn(),
  updateCompetitivePlatform: vi.fn(), updateCompetitivePlatformRankLabel: vi.fn(), updateCompetitivePlatformSeason: vi.fn(),
}));

beforeAll(() => Object.assign(window.HTMLElement.prototype, { scrollIntoView: () => {}, hasPointerCapture: () => false, releasePointerCapture: () => {} }));

describe("CompetitivePlatformCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the official Rating, chronology roles and low-to-high rank controls", async () => {
    const user = userEvent.setup();
    render(<CompetitivePlatformCatalog platforms={[{
      key: "perfect_world", displayName: "完美世界竞技平台", ratingLabel: "Rating Pro",
      ranks: [{ id: "rank-1", rankKey: "C+", label: "C+", sortOrder: 0, starMin: null, starMax: null }],
      seasons: [
        { id: "s23", seasonKey: "S23", label: "S23", sortOrder: 1, active: true, isCurrent: false },
        { id: "s24", seasonKey: "S24", label: "S24", sortOrder: 2, active: true, isCurrent: true },
      ],
    }]} />);

    expect(screen.getByText(/平台官方竞技评分：Rating Pro/)).toBeInTheDocument();
    expect(screen.getByText("当前赛季")).toBeInTheDocument();
    expect(screen.getByText("上一赛季")).toBeInTheDocument();
    expect(screen.getByText("段位顺序 · 由低到高")).toBeInTheDocument();
    expect(screen.getByTitle("上移（更低段位方向）")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "设为当前赛季" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("切换当前赛季")).toBeInTheDocument();
    expect(screen.getByText(/平台官方竞技评分：Rating Pro（由产品定义，不可在后台修改）/)).toBeInTheDocument();
  });

  it("routes built-in catalog mutations through the shared actions without exposing platform creation", async () => {
    vi.mocked(createCompetitivePlatformRank).mockResolvedValue({ success: true, data: { id: "rank-b" } });
    vi.mocked(updateCompetitivePlatform).mockResolvedValue({ success: true, data: undefined });
    vi.mocked(deleteCompetitivePlatformRank).mockResolvedValue({ success: true, data: undefined });
    const user = userEvent.setup();
    const platform = {
      key: "fivee", displayName: "5E", ratingLabel: "Rating+",
      ranks: [{ id: "rank-c", rankKey: "C+", label: "C+", sortOrder: 0, starMin: null, starMax: null }],
      seasons: [{ id: "s6", seasonKey: "S6", label: "S6", sortOrder: 6, active: true, isCurrent: true }],
    };
    render(<CompetitivePlatformCatalog platforms={[platform]} />);
    expect(screen.queryByRole("button", { name: "创建平台" })).not.toBeInTheDocument();
    // 平台官方竞技评分由产品定义，仅供展示。
    expect(screen.getByText(/平台官方竞技评分：Rating\+/)).toBeInTheDocument();
    expect(screen.queryByLabelText("官方竞技评分名称")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "修改平台信息" }));
    expect(screen.queryByLabelText("官方竞技评分名称")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("平台显示名称"));
    await user.type(screen.getByLabelText("平台显示名称"), "5E 对战平台");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(updateCompetitivePlatform).toHaveBeenCalledWith({ key: "fivee", displayName: "5E 对战平台" });

    await user.click(screen.getByRole("button", { name: "+ 添加段位" }));
    await user.type(screen.getByPlaceholderText("例如 S+"), "B+");
    await user.type(screen.getByPlaceholderText("例如 c_plus、C+ 或 青铜S"), "b_plus");
    await user.click(screen.getByRole("button", { name: "创建" }));
    expect(createCompetitivePlatformRank).toHaveBeenCalledWith({ platform: "fivee", label: "B+", rankKey: "b_plus" });

    await user.click(screen.getAllByRole("button", { name: "删除" })[1]!);
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(deleteCompetitivePlatformRank).toHaveBeenCalledWith({ id: "rank-c" });
  });

  it("opens a compact season dialog with the name as the primary input and a generated key preview", async () => {
    const user = userEvent.setup();
    render(<CompetitivePlatformCatalog platforms={[{
      key: "perfect_world", displayName: "完美世界竞技平台", ratingLabel: "Rating Pro",
      ranks: [], seasons: [],
    }]} />);
    await user.click(screen.getByRole("button", { name: "+ 新增赛季" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("赛季名称")).toBeInTheDocument();
    expect(screen.queryByLabelText("稳定标识（创建后不可修改）")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("赛季名称"), "2025 S4");
    expect(screen.getByText("2025-s4")).toBeInTheDocument();
    expect(screen.getByText("稳定标识：2025-s4")).toBeInTheDocument();
  });

  it("allows an advanced stable-key override without letting later name changes overwrite it", async () => {
    const user = userEvent.setup();
    render(<CompetitivePlatformCatalog platforms={[{
      key: "perfect_world", displayName: "完美世界竞技平台", ratingLabel: "Rating Pro",
      ranks: [], seasons: [],
    }]} />);
    await user.click(screen.getByRole("button", { name: "+ 新增赛季" }));
    await user.type(screen.getByLabelText("赛季名称"), "2025 S4");
    await user.click(screen.getByRole("button", { name: "高级设置" }));

    const stableKeyInput = screen.getByLabelText("稳定标识（创建后不可修改）");
    expect(stableKeyInput).toHaveValue("2025-s4");
    await user.clear(stableKeyInput);
    await user.type(stableKeyInput, "legacy-s4");
    await user.clear(screen.getByLabelText("赛季名称"));
    await user.type(screen.getByLabelText("赛季名称"), "2025 S5");

    expect(stableKeyInput).toHaveValue("legacy-s4");
    expect(screen.getByText("稳定标识：legacy-s4")).toBeInTheDocument();
  });

  it("submits latest placement without an insertAt and closes only after a successful backfill", async () => {
    vi.mocked(createCompetitivePlatformSeason).mockResolvedValue({ success: true, data: { id: "season-new" } });
    const user = userEvent.setup();
    render(<CompetitivePlatformCatalog platforms={[{
      key: "perfect_world", displayName: "完美世界竞技平台", ratingLabel: "Rating Pro",
      ranks: [], seasons: [],
    }]} />);
    await user.click(screen.getByRole("button", { name: "+ 新增赛季" }));
    await user.type(screen.getByLabelText("赛季名称"), "2025 S4");
    expect(screen.getByText("时间位置：作为最新赛季")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "添加赛季" }));

    await waitFor(() => expect(createCompetitivePlatformSeason).toHaveBeenCalledWith({ platform: "perfect_world", seasonKey: "2025-s4", label: "2025 S4" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(setCurrentCompetitivePlatformSeason).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("赛季已新增");
    expect(refreshMock).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "+ 新增赛季" }));
    expect(screen.getByLabelText("赛季名称")).toHaveValue("");
  });

  it("maps a visible historical gap to the older season's after action payload", async () => {
    vi.mocked(createCompetitivePlatformSeason).mockResolvedValue({ success: true, data: { id: "season-new" } });
    const user = userEvent.setup();
    render(<CompetitivePlatformCatalog platforms={[{
      key: "perfect_world", displayName: "完美世界竞技平台", ratingLabel: "Rating Pro",
      ranks: [],
      seasons: [
        { id: "s3", seasonKey: "2025-s3", label: "2025 S3", sortOrder: 10, active: true, isCurrent: false },
        { id: "s4", seasonKey: "2025-s4", label: "2025 S4", sortOrder: 20, active: true, isCurrent: false },
        { id: "s1", seasonKey: "2026-s1", label: "2026 S1", sortOrder: 30, active: true, isCurrent: true },
      ],
    }]} />);
    await user.click(screen.getByRole("button", { name: "+ 新增赛季" }));
    await user.type(screen.getByLabelText("赛季名称"), "2025 S3.5");
    await user.click(screen.getByRole("combobox", { name: "时间位置" }));
    await user.click(screen.getByRole("option", { name: "位于 2026 S1 与 2025 S4 之间" }));

    expect(screen.getByText("时间位置：位于 2026 S1 与 2025 S4 之间")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "添加赛季" }));
    await waitFor(() => expect(createCompetitivePlatformSeason).toHaveBeenCalledWith({
      platform: "perfect_world",
      seasonKey: "2025-s3.5",
      label: "2025 S3.5",
      insertAt: { seasonId: "s4", position: "after" },
    }));
  });

  it("maps an earliest placement to the action's before contract", async () => {
    vi.mocked(createCompetitivePlatformSeason).mockResolvedValue({ success: true, data: { id: "season-new" } });
    const user = userEvent.setup();
    render(<CompetitivePlatformCatalog platforms={[{
      key: "perfect_world", displayName: "完美世界竞技平台", ratingLabel: "Rating Pro",
      ranks: [],
      seasons: [{ id: "s1", seasonKey: "2025-s1", label: "2025 S1", sortOrder: 10, active: true, isCurrent: true }],
    }]} />);
    await user.click(screen.getByRole("button", { name: "+ 新增赛季" }));
    await user.type(screen.getByLabelText("赛季名称"), "2024 S4");
    await user.click(screen.getByRole("combobox", { name: "时间位置" }));
    await user.click(screen.getByRole("option", { name: "早于最早赛季（2025 S1）" }));
    await user.click(screen.getByRole("button", { name: "添加赛季" }));

    await waitFor(() => expect(createCompetitivePlatformSeason).toHaveBeenCalledWith({
      platform: "perfect_world",
      seasonKey: "2024-s4",
      label: "2024 S4",
      insertAt: { seasonId: "s1", position: "before" },
    }));
  });

  it("keeps the dialog and draft when creation fails", async () => {
    vi.mocked(createCompetitivePlatformSeason).mockResolvedValue({ success: false, error: { code: "VALIDATION_FAILED", message: "该平台已存在该赛季。" } });
    const user = userEvent.setup();
    render(<CompetitivePlatformCatalog platforms={[{
      key: "perfect_world", displayName: "完美世界竞技平台", ratingLabel: "Rating Pro",
      ranks: [], seasons: [],
    }]} />);
    await user.click(screen.getByRole("button", { name: "+ 新增赛季" }));
    await user.type(screen.getByLabelText("赛季名称"), "2025 S4");
    await user.click(screen.getByRole("button", { name: "添加赛季" }));

    await waitFor(() => expect(createCompetitivePlatformSeason).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("赛季名称")).toHaveValue("2025 S4");
    expect(toastErrorMock).toHaveBeenCalledWith("该平台已存在该赛季。");
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
