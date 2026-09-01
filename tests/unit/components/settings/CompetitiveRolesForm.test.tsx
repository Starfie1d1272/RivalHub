/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompetitiveRolesForm } from "@/components/settings/CompetitiveRolesForm";

const { saveCompetitiveRolesMock } = vi.hoisted(() => ({ saveCompetitiveRolesMock: vi.fn() }));

vi.mock("@/actions/competitive-profile", () => ({ saveCompetitiveRoles: saveCompetitiveRolesMock }));

describe("CompetitiveRolesForm", () => {
  beforeEach(() => saveCompetitiveRolesMock.mockReset());

  it("uses the canonical five-position taxonomy", () => {
    render(<CompetitiveRolesForm initialRoles={["opener"]} initialPrimaryRole="opener" />);

    expect(screen.getByText("IGL（指挥）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Opener（突破手）/ })).toBeInTheDocument();
    expect(screen.queryByText(/Support|Lurker|Entry/)).not.toBeInTheDocument();
  });

  it("makes primary and secondary selected states distinct", () => {
    render(<CompetitiveRolesForm initialRoles={["opener", "anchor"]} initialPrimaryRole="opener" />);

    expect(screen.getByText("主位置")).toHaveClass("bg-[var(--color-accent)]");
    expect(screen.getByRole("button", { name: "设为主位置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Opener（突破手）/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /IGL（指挥）/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps select, fallback, and save semantics", async () => {
    saveCompetitiveRolesMock.mockResolvedValue({ success: true, data: undefined });
    render(<CompetitiveRolesForm initialRoles={[]} initialPrimaryRole={null} />);

    fireEvent.click(screen.getByRole("button", { name: /Opener（突破手）/ }));
    fireEvent.click(screen.getByRole("button", { name: /Anchor（主防）/ }));
    fireEvent.click(screen.getByRole("button", { name: "设为主位置" }));
    fireEvent.click(screen.getByRole("button", { name: /Opener（突破手）/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存位置偏好" }));

    await waitFor(() => expect(saveCompetitiveRolesMock).toHaveBeenCalledWith({ roles: ["anchor"], primaryRole: "anchor" }));
  });
});
