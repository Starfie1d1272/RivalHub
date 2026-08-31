/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MyReadinessDashboard } from "@/components/my/MyReadinessDashboard";
import type { MyReadinessModel } from "@/lib/my/readiness";

const item = (title: string, state: "ready" | "unknown" = "ready") => ({
  id: title,
  title,
  state,
  detail: `${title} 说明`,
  owner: "我",
  cta: { href: "/settings", label: `处理${title}` },
});

const model: MyReadinessModel = {
  displayName: "选手甲",
  profile: item("长期个人资料"),
  education: item("教育认证"),
  competitiveProfiles: [{ key: "perfect_world", displayName: "完美世界竞技", state: "ready", blockers: [] }],
  team: item("长期 Team"),
  competitions: [{
    id: "entry-1",
    name: "Rival Five",
    seasonName: "2026 秋季赛",
    href: "/major-2026/register",
    entry: item("当前报名状态"),
    qualification: item("个人 qualification", "unknown"),
    sanctions: [{
      id: "case-1",
      seasonId: "season-1",
      seasonName: "2026 秋季赛",
      seasonSlug: "major-2026",
      effects: ["registration_block", "roster_block", "match_participation_block"],
      explanation: "公开说明",
      effectiveFrom: new Date("2026-08-01T00:00:00Z"),
      effectiveUntil: null,
    }],
  }],
  sanctions: [{
    id: "case-1",
    seasonId: "season-1",
    seasonName: "2026 秋季赛",
    seasonSlug: "major-2026",
    effects: ["registration_block", "roster_block", "match_participation_block"],
    explanation: "公开说明",
    effectiveFrom: new Date("2026-08-01T00:00:00Z"),
    effectiveUntil: null,
  }],
};

describe("MyReadinessDashboard", () => {
  it("shows blocker owner and CTA while keeping eligibility distinct from profile readiness", () => {
    render(<MyReadinessDashboard model={model} />);

    expect(screen.getByText(/资料齐全不等于某届赛事一定可报名或出场/)).toBeInTheDocument();
    expect(screen.getByText(/个人 qualification 只说明你的资料/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "处理长期个人资料" })).toHaveAttribute("href", "/settings");
    expect(screen.getByText("不可确认")).toBeInTheDocument();
  });

  it("renders all three sanction effects without private evidence", () => {
    render(<MyReadinessDashboard model={model} />);

    expect(screen.getByText(/阻止报名、阻止进入赛事 roster、阻止单场出场/)).toBeInTheDocument();
    expect(screen.getByText("说明：公开说明")).toBeInTheDocument();
    expect(screen.queryByText(/internalEvidence|私密证据|管理员备注/)).not.toBeInTheDocument();
  });
});
