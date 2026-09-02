/** @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CompetitiveProfileForm } from "@/components/settings/CompetitiveProfileForm";

const { saveCompetitiveProfileMock } = vi.hoisted(() => ({ saveCompetitiveProfileMock: vi.fn() }));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/competitive-profile", () => ({ saveCompetitiveProfile: saveCompetitiveProfileMock }));

beforeAll(() => Object.assign(window.HTMLElement.prototype, { scrollIntoView: () => {}, hasPointerCapture: () => false, releasePointerCapture: () => {} }));

const perfect = {
  platform: "perfect_world", platformDisplayName: "完美世界竞技平台", ratingLabel: "Rating Pro",
  ladder: [
    { rankKey: "A", label: "A", starMin: null, starMax: null },
    { rankKey: "gold", label: "黄金S", starMin: 1, starMax: 20 },
  ],
  seasons: [
    { seasonKey: "2025s3", label: "2025S3", isCurrent: false, isPrevious: false },
    { seasonKey: "2025s4", label: "2025S4", isCurrent: false, isPrevious: false },
    { seasonKey: "2026s1", label: "2026S1", isCurrent: false, isPrevious: true },
    { seasonKey: "2026s2", label: "2026S2", isCurrent: true, isPrevious: false },
  ],
  facts: [
    { kind: "historical_peak" as const, platformSeasonKey: null, status: "ranked" as const, rank: "A", rating: "2100", stars: null, achievedSeasonKey: "2025s4" },
    { kind: "season_peak" as const, platformSeasonKey: "2025s4", status: "unranked" as const, rank: null, rating: null, stars: null, achievedSeasonKey: null },
  ],
};

function sectionByHeading(name: string) {
  const heading = screen.getByRole("heading", { name });
  const section = heading.closest("section");
  if (!section) throw new Error(`Missing section for ${name}`);
  return within(section as HTMLElement);
}

describe("CompetitiveProfileForm", () => {
  beforeEach(() => {
    saveCompetitiveProfileMock.mockReset().mockResolvedValue({ success: true, data: undefined });
  });

  it("prioritizes Perfect World and keeps historical peak provenance in one section", () => {
    render(<CompetitiveProfileForm contexts={[{ ...perfect, platform: "fivee", platformDisplayName: "5E" }, perfect]} />);

    expect(screen.getByText(/完美世界竞技平台 · 长期竞技资料/)).toBeInTheDocument();
    expect(screen.getByText(/未录入表示尚未声明；未定级是有效事实/)).toBeInTheDocument();
    expect(screen.getByText("竞技资料")).toBeInTheDocument();
    expect(screen.getByText("历史最高")).toBeInTheDocument();
    expect(sectionByHeading("历史最高").getByText("历史最高达成赛季（可选）")).toBeInTheDocument();
    expect(sectionByHeading("近期赛季").getByText("当前赛季 · 2026S2")).toBeInTheDocument();
    expect(sectionByHeading("近期赛季").getByText("上一赛季 · 2026S1")).toBeInTheDocument();
    expect(sectionByHeading("近期赛季").queryByText("历史赛季 · 2025S4")).toBeNull();
    expect(sectionByHeading("更早历史资料").getByText("历史赛季 · 2025S4")).toBeInTheDocument();
  });

  it("keeps unmaintained older catalog seasons hidden until all history is viewed, then collapses again", async () => {
    const user = userEvent.setup();
    render(<CompetitiveProfileForm contexts={[perfect]} />);

    const older = sectionByHeading("更早历史资料");
    expect(older.getByText("历史赛季 · 2025S4")).toBeInTheDocument();
    expect(older.queryByText("历史赛季 · 2025S3")).toBeNull();
    const expand = older.getByRole("button", { name: "查看全部历史赛季（1）" });
    expect(expand).toHaveAttribute("aria-expanded", "false");

    await user.click(expand);
    expect(older.getByText("历史赛季 · 2025S3")).toBeInTheDocument();
    expect(older.getByRole("button", { name: "收起历史赛季" })).toHaveAttribute("aria-expanded", "true");

    await user.click(older.getByRole("button", { name: "收起历史赛季" }));
    expect(older.queryByText("历史赛季 · 2025S3")).toBeNull();
  });

  it("keeps older maintained facts compact until editing and preserves the three fact states", async () => {
    const user = userEvent.setup();
    const context = {
      ...perfect,
      seasons: [
        { seasonKey: "2025s2", label: "2025S2", isCurrent: false, isPrevious: false },
        ...perfect.seasons,
      ],
      facts: [
        perfect.facts[0],
        { kind: "season_peak" as const, platformSeasonKey: "2025s3", status: "ranked" as const, rank: "gold", rating: "1500", stars: 12, achievedSeasonKey: null },
        { kind: "season_peak" as const, platformSeasonKey: "2025s4", status: "unranked" as const, rank: null, rating: "1800", stars: null, achievedSeasonKey: null },
      ],
    };
    render(<CompetitiveProfileForm contexts={[context]} />);

    const older = sectionByHeading("更早历史资料");
    expect(older.getByRole("button", { name: "编辑 历史赛季 · 2025S4" })).toBeInTheDocument();
    expect(older.getByText("黄金S · 12★ · Rating Pro 1500")).toBeInTheDocument();
    expect(older.getByText("未定级 · Rating Pro 1800")).toBeInTheDocument();
    expect(older.queryByText("历史赛季 · 2025S2")).toBeNull();
    expect(screen.getAllByText("资料状态")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "编辑 历史赛季 · 2025S4" }));
    expect(screen.getAllByText("资料状态")).toHaveLength(3);
    expect(older.getByRole("button", { name: "收起 历史赛季 · 2025S4" })).toBeInTheDocument();

    await user.click(older.getByRole("button", { name: "收起 历史赛季 · 2025S4" }));
    expect(screen.getAllByText("资料状态")).toHaveLength(2);
    expect(older.getByRole("button", { name: "编辑 历史赛季 · 2025S4" })).toBeInTheDocument();
    await user.click(older.getByRole("button", { name: "查看全部历史赛季（1）" }));
    expect(older.getByText("历史赛季 · 2025S2")).toBeInTheDocument();
    expect(older.getByText("未录入")).toBeInTheDocument();
  });

  it("allows only one older editor at a time and returns the previous row to compact mode", async () => {
    const user = userEvent.setup();
    const context = {
      ...perfect,
      facts: [
        perfect.facts[0],
        { kind: "season_peak" as const, platformSeasonKey: "2025s3", status: "unranked" as const, rank: null, rating: "1500", stars: null, achievedSeasonKey: null },
        { kind: "season_peak" as const, platformSeasonKey: "2025s4", status: "unranked" as const, rank: null, rating: "1600", stars: null, achievedSeasonKey: null },
      ],
    };
    render(<CompetitiveProfileForm contexts={[context]} />);

    const older = sectionByHeading("更早历史资料");
    await user.click(older.getByRole("button", { name: "编辑 历史赛季 · 2025S4" }));
    expect(screen.getAllByText("资料状态")).toHaveLength(3);
    expect(older.getByRole("button", { name: "编辑 历史赛季 · 2025S3" })).toBeInTheDocument();

    await user.click(older.getByRole("button", { name: "编辑 历史赛季 · 2025S3" }));
    expect(screen.getAllByText("资料状态")).toHaveLength(3);
    expect(older.getByRole("button", { name: "编辑 历史赛季 · 2025S4" })).toBeInTheDocument();
    expect(older.queryByRole("button", { name: "收起 历史赛季 · 2025S4" })).toBeNull();
    expect(older.getByRole("button", { name: "收起 历史赛季 · 2025S3" })).toBeInTheDocument();

    await user.click(older.getByRole("button", { name: "收起 历史赛季 · 2025S3" }));
    expect(screen.getAllByText("资料状态")).toHaveLength(2);
    expect(older.getByRole("button", { name: "编辑 历史赛季 · 2025S3" })).toBeInTheDocument();
  });

  it("resets history expansion and the active older editor when switching platform", async () => {
    const user = userEvent.setup();
    render(<CompetitiveProfileForm contexts={[perfect, { ...perfect, platform: "fivee", platformDisplayName: "5E" }]} />);

    const older = sectionByHeading("更早历史资料");
    await user.click(older.getByRole("button", { name: "查看全部历史赛季（1）" }));
    await user.click(older.getByRole("button", { name: "补充 历史赛季 · 2025S3" }));
    expect(older.getByRole("button", { name: "收起 历史赛季 · 2025S3" })).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "竞技平台" }));
    await user.click(screen.getByRole("option", { name: "5E" }));

    expect(screen.getByText("5E · 长期竞技资料")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看全部历史赛季（1）" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "收起 历史赛季 · 2025S3" })).toBeNull();
    expect(screen.queryByText("历史赛季 · 2025S3")).toBeNull();
  });

  it("keeps the existing profile save payload across the catalog", async () => {
    const user = userEvent.setup();
    render(<CompetitiveProfileForm contexts={[perfect]} />);

    await user.click(screen.getByRole("button", { name: "保存竞技档案" }));

    await waitFor(() => expect(saveCompetitiveProfileMock).toHaveBeenCalledWith({
      platform: "perfect_world",
      historicalPeak: { status: "ranked", rank: "A", rating: 2100, stars: null, achievedSeasonKey: "2025s4" },
      seasonPeaks: [
        { seasonKey: "2025s3", status: "unrecorded" },
        { seasonKey: "2025s4", status: "unranked", rating: null },
        { seasonKey: "2026s1", status: "unrecorded" },
        { seasonKey: "2026s2", status: "unrecorded" },
      ],
    }));
  });
});
