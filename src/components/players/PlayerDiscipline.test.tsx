import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlayerAvatar } from "./PlayerAvatar";
import { PlayerActiveSanctions, PlayerDisciplineHistory } from "./PlayerDiscipline";
import type { PublicPlayerSanction } from "@/lib/discipline/public-query";

afterEach(cleanup);
const sanction = (status: PublicPlayerSanction["status"]): PublicPlayerSanction => ({
  id: status, seasonId: "event", subjectUserId: "player", status,
  seasonName: "Spring Rivals", seasonSlug: "spring-rivals",
  effects: ["registration_block", "match_participation_block"], explanation: "公开处罚说明",
  effectiveFrom: new Date("2026-03-01T00:00:00Z"), effectiveUntil: null, issuedAt: new Date("2026-03-01T00:00:00Z"),
});

describe("public player discipline states", () => {
  it("shows the event, capabilities and open-ended window only in the active notice", () => {
    render(<PlayerActiveSanctions sanctions={[sanction("active"), sanction("revoked"), sanction("expired"), sanction("draft")]} />);
    expect(screen.getByRole("heading", { name: "当前存在赛事纪律处罚" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Spring Rivals" })).toHaveAttribute("href", "/spring-rivals");
    expect(screen.getByText("禁止报名 · 禁止单场出场")).toBeVisible();
    expect(screen.getByText(/长期有效/)).toBeVisible();
    expect(screen.queryByText("已撤销")).not.toBeInTheDocument();
  });

  it("keeps expired/revoked history distinct and hides draft and active entries", () => {
    render(<><PlayerActiveSanctions sanctions={[sanction("revoked"), sanction("expired")]} /><PlayerDisciplineHistory sanctions={[sanction("revoked"), sanction("expired"), sanction("draft"), sanction("active")]} /></>);
    expect(screen.queryByText("当前存在赛事纪律处罚")).not.toBeInTheDocument();
    expect(screen.getByText("已撤销")).toBeVisible();
    expect(screen.getByText("已到期")).toBeVisible();
    expect(screen.queryByText("生效中")).not.toBeInTheDocument();
    expect(screen.queryByText(/长期有效/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("labels every sanctioned avatar size while retaining the accessible event-sanction meaning", () => {
    const { rerender } = render(<PlayerAvatar name="Player" size="sm" hasActivePublicSanction />);
    expect(screen.getByRole("img", { name: "Player · 当前存在赛事纪律处罚" })).toHaveAttribute("title", "Player · 当前存在赛事纪律处罚");
    expect(screen.getByText("已禁赛")).toBeInTheDocument();
    rerender(<PlayerAvatar name="Player" size="md" hasActivePublicSanction />);
    expect(screen.getByText("已禁赛")).toBeInTheDocument();
    rerender(<PlayerAvatar name="Player" size="lg" hasActivePublicSanction />);
    expect(screen.getByText("已禁赛")).toBeInTheDocument();
    rerender(<PlayerAvatar name="Player" />);
    expect(screen.getByRole("img", { name: "Player" })).toBeVisible();
    expect(screen.queryByText("已禁赛")).not.toBeInTheDocument();
  });
});
