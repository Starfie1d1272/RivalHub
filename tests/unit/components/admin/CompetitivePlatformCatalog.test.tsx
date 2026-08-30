/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CompetitivePlatformCatalog } from "@/components/admin/CompetitivePlatformCatalog";
import { createCompetitivePlatformRank, deleteCompetitivePlatformRank, updateCompetitivePlatform } from "@/actions/competitive-platform";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/competitive-platform", () => ({
  createCompetitivePlatformRank: vi.fn(), createCompetitivePlatformSeason: vi.fn(),
  deleteCompetitivePlatformRank: vi.fn(), deleteCompetitivePlatformSeason: vi.fn(), moveCompetitivePlatformRank: vi.fn(),
  moveCompetitivePlatformSeason: vi.fn(), setCurrentCompetitivePlatformSeason: vi.fn(), setCompetitivePlatformSeasonActive: vi.fn(),
  updateCompetitivePlatform: vi.fn(), updateCompetitivePlatformRankLabel: vi.fn(), updateCompetitivePlatformSeason: vi.fn(),
}));

describe("CompetitivePlatformCatalog", () => {
  it("shows the canonical Rating, chronology roles and low-to-high rank controls", async () => {
    const user = userEvent.setup();
    render(<CompetitivePlatformCatalog platforms={[{
      key: "perfect_world", displayName: "完美世界竞技平台", ratingLabel: "Rating Pro",
      ranks: [{ id: "rank-1", rankKey: "C+", label: "C+", sortOrder: 0, starMin: null, starMax: null }],
      seasons: [
        { id: "s23", seasonKey: "S23", label: "S23", sortOrder: 1, active: true, isCurrent: false },
        { id: "s24", seasonKey: "S24", label: "S24", sortOrder: 2, active: true, isCurrent: true },
      ],
    }]} />);

    expect(screen.getByText("canonical performance Rating：Rating Pro")).toBeInTheDocument();
    expect(screen.getByText("当前赛季")).toBeInTheDocument();
    expect(screen.getByText("上一赛季")).toBeInTheDocument();
    expect(screen.getByText("段位顺序 · 由低到高")).toBeInTheDocument();
    expect(screen.getByTitle("上移（更低段位方向）")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "设为当前赛季" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("切换当前赛季")).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "修改平台信息" }));
    await user.clear(screen.getByLabelText("canonical Rating 名称"));
    await user.type(screen.getByLabelText("canonical Rating 名称"), "Elo");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(updateCompetitivePlatform).toHaveBeenCalledWith({ key: "fivee", displayName: "5E", ratingLabel: "Elo" });

    await user.click(screen.getByRole("button", { name: "+ 添加段位" }));
    await user.type(screen.getByPlaceholderText("例如 S+"), "B+");
    await user.type(screen.getByPlaceholderText("例如 c_plus、C+ 或 青铜S"), "b_plus");
    await user.click(screen.getByRole("button", { name: "创建" }));
    expect(createCompetitivePlatformRank).toHaveBeenCalledWith({ platform: "fivee", label: "B+", rankKey: "b_plus" });

    await user.click(screen.getAllByRole("button", { name: "删除" })[1]!);
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(deleteCompetitivePlatformRank).toHaveBeenCalledWith({ id: "rank-c" });
  });
});
