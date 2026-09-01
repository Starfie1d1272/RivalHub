/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TeamDirectoryCard } from "@/components/teams/TeamDirectoryCard";

describe("TeamDirectoryCard", () => {
  it("uses the long-lived Team identity, status presentation, and directory facts", () => {
    render(<TeamDirectoryCard slug="rival-team" name="Rival Team" logoUrl={null} description={null} recruiting memberCount={5} status="active" captainName="队长甲" />);

    expect(screen.getByRole("link")).toHaveAttribute("href", "/teams/rival-team");
    expect(screen.getByText("R")).toBeInTheDocument();
    expect(screen.getByText("活跃")).toBeInTheDocument();
    expect(screen.getByText("招募中")).toBeInTheDocument();
    expect(screen.getByText("暂无简介")).toBeInTheDocument();
    expect(screen.getByText("队长甲")).toBeInTheDocument();
    expect(screen.getByText(/5 名当前成员/)).toBeInTheDocument();
  });

  it("presents a disbanded Team without carrying the recruiting badge", () => {
    render(<TeamDirectoryCard slug="old-team" name="Old Team" logoUrl={null} description="历史队伍" recruiting status="disbanded" captainName="队长乙" memberCount={0} />);

    expect(screen.getByText("已解散")).toBeInTheDocument();
    expect(screen.queryByText("招募中")).not.toBeInTheDocument();
  });
});
