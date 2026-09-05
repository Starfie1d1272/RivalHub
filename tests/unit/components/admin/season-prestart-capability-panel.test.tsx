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
    expect(screen.getByRole("link", { name: /选秀控制/ })).toHaveAttribute("href", "/admin/rivals-s1/draft");
  });

  it("does not invent a prestart module when no capability is connected", () => {
    render(<SeasonPrestartCapabilityPanel seasonSlug="custom-s1" seasonName="Custom S1" hasCaptainVoting={false} hasDraft={false} stagePlan={[]} />);

    expect(screen.getByText("当前赛事没有额外的已接入赛前运营模块。"))
      .toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /队长确认|选秀控制/ })).not.toBeInTheDocument();
  });
});
