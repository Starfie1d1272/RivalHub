/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { SeasonPrestartCapabilityPanel } from "@/components/admin/SeasonPrestartCapabilityPanel";

describe("SeasonPrestartCapabilityPanel", () => {
  it("keeps capability-specific captain and draft routes under the prestart workspace", () => {
    render(<SeasonPrestartCapabilityPanel seasonSlug="rivals-s1" seasonName="Rivals S1" hasCaptainVoting hasDraft stagePlan={[]} />);

    expect(screen.getByRole("link", { name: /队长确认/ })).toHaveAttribute("href", "/admin/rivals-s1/captains");
    expect(screen.getByRole("link", { name: /选秀管理/ })).toHaveAttribute("href", "/admin/rivals-s1/draft");
  });

  it("does not invent a prestart module when no capability is connected", () => {
    render(<SeasonPrestartCapabilityPanel seasonSlug="custom-s1" seasonName="Custom S1" hasCaptainVoting={false} hasDraft={false} stagePlan={[]} />);

    expect(screen.getByText("本届暂无额外赛前操作。"))
      .toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /队长确认|选秀管理/ })).not.toBeInTheDocument();
  });
});
