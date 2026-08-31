/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompetitiveRolesForm } from "@/components/settings/CompetitiveRolesForm";

vi.mock("@/actions/competitive-profile", () => ({ saveCompetitiveRoles: vi.fn() }));

describe("CompetitiveRolesForm", () => {
  it("uses the canonical five-position taxonomy", () => {
    render(<CompetitiveRolesForm initialRoles={["opener"]} initialPrimaryRole="opener" />);

    expect(screen.getByText("IGL（指挥）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Opener（突破手）/ })).toBeInTheDocument();
    expect(screen.queryByText(/Support|Lurker|Entry/)).not.toBeInTheDocument();
  });
});
