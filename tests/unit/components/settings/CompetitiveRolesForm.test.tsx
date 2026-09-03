/** @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CompetitiveRolesForm } from "@/components/settings/CompetitiveRolesForm";

const { saveCompetitiveRolesMock, toastErrorMock } = vi.hoisted(() => ({
  saveCompetitiveRolesMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/actions/competitive-profile", () => ({ saveCompetitiveRoles: saveCompetitiveRolesMock }));
vi.mock("sonner", () => ({ toast: { error: toastErrorMock, success: vi.fn() } }));

beforeAll(() => Object.assign(window.HTMLElement.prototype, { hasPointerCapture: () => false, releasePointerCapture: () => {}, scrollIntoView: () => {} }));

function positionButton(label: string) {
  return screen.getByRole("button", { name: new RegExp(label) });
}

describe("CompetitiveRolesForm", () => {
  beforeEach(() => {
    saveCompetitiveRolesMock.mockReset().mockResolvedValue({ success: true, data: undefined });
    toastErrorMock.mockReset();
  });

  it("renders the canonical five positions as compact pressed controls", () => {
    render(<CompetitiveRolesForm initialRoles={[]} initialPrimaryRole={null} />);

    expect(screen.getByRole("group", { name: "常用位置" })).toBeInTheDocument();
    expect(screen.getByText("最多选择 3 个")).toBeInTheDocument();
    for (const label of ["IGL（指挥）", "AWPer（狙击手）", "Opener（突破手）", "Closer（自由人/残局）", "Anchor（主防）"]) {
      expect(positionButton(label)).toHaveAttribute("aria-pressed", "false");
    }
    expect(screen.queryByText(/Support|Lurker|Entry/)).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "常用位置" })).toHaveClass("flex", "flex-wrap");
  });

  it("supports keyboard focus and keeps the 1–3 selection limit", async () => {
    const user = userEvent.setup();
    render(<CompetitiveRolesForm initialRoles={[]} initialPrimaryRole={null} />);

    await user.tab();
    expect(positionButton("IGL（指挥）")).toHaveFocus();
    expect(positionButton("IGL（指挥）")).toHaveClass("focus-visible:ring-2");

    await user.click(positionButton("IGL（指挥）"));
    await user.click(positionButton("AWPer（狙击手）"));
    await user.click(positionButton("Opener（突破手）"));
    await user.click(positionButton("Closer（自由人/残局）"));

    expect(positionButton("IGL（指挥）")).toHaveAttribute("aria-pressed", "true");
    expect(positionButton("AWPer（狙击手）")).toHaveAttribute("aria-pressed", "true");
    expect(positionButton("Opener（突破手）")).toHaveAttribute("aria-pressed", "true");
    expect(positionButton("Closer（自由人/残局）")).toHaveAttribute("aria-pressed", "false");
    expect(toastErrorMock).toHaveBeenCalledWith("最多选择 3 个位置");
  });

  it("limits primary options to selected roles and falls back when primary is deselected", async () => {
    const user = userEvent.setup();
    render(<CompetitiveRolesForm initialRoles={["opener", "anchor"]} initialPrimaryRole="opener" />);

    const primary = screen.getByRole("combobox", { name: "主位置" });
    await user.click(primary);
    expect(screen.getByRole("option", { name: "Anchor（主防）" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "IGL（指挥）" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Anchor（主防）" }));
    expect(primary).toHaveTextContent("Anchor（主防）");

    await user.click(positionButton("Anchor（主防）"));
    expect(primary).toHaveTextContent("Opener（突破手）");

    await user.click(positionButton("Opener（突破手）"));
    expect(primary).toBeDisabled();
  });

  it("preserves the save payload after selection and primary fallback", async () => {
    const user = userEvent.setup();
    render(<CompetitiveRolesForm initialRoles={[]} initialPrimaryRole={null} />);

    await user.click(positionButton("Opener（突破手）"));
    await user.click(positionButton("Anchor（主防）"));
    await user.click(screen.getByRole("combobox", { name: "主位置" }));
    await user.click(screen.getByRole("option", { name: "Anchor（主防）" }));
    await user.click(positionButton("Opener（突破手）"));
    await user.click(screen.getByRole("button", { name: "保存位置偏好" }));

    await waitFor(() => expect(saveCompetitiveRolesMock).toHaveBeenCalledWith({ roles: ["anchor"], primaryRole: "anchor" }));
  });
});
