/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StagePlanEditor } from "@/components/admin/StagePlanEditor";
import { RIVALS_STAGE_PLAN } from "@/types/season";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const SelectContext = React.createContext<{ onValueChange?: (value: string) => void; disabled: boolean }>({ disabled: false });

  return {
    Select: ({ children, onValueChange, disabled = false }: { children: React.ReactNode; onValueChange?: (value: string) => void; disabled?: boolean }) =>
      React.createElement(SelectContext.Provider, { value: { onValueChange, disabled } }, children),
    SelectContent: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ children, value, disabled = false }: { children: React.ReactNode; value: string; disabled?: boolean }) => {
      const context = React.useContext(SelectContext);
      return React.createElement("button", { type: "button", disabled: disabled || context.disabled, onClick: () => context.onValueChange?.(value) }, children);
    },
    SelectTrigger: ({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) => React.createElement("div", { "aria-disabled": disabled }, children),
    SelectValue: ({ placeholder }: { placeholder?: string }) => React.createElement("span", null, placeholder),
  };
});

describe("StagePlanEditor locked mode", () => {
  it("does not allow adding, deleting, editing, or applying a preset", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StagePlanEditor value={structuredClone(RIVALS_STAGE_PLAN)} disabled onChange={onChange} />);

    expect(screen.getByRole("button", { name: "添加阶段" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "删除阶段" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getByRole("button", { name: "Rivals 8队" })).toBeDisabled();
    expect(screen.getAllByRole("textbox").every((input) => (input as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getAllByRole("spinbutton").every((input) => (input as HTMLInputElement).disabled)).toBe(true);

    await user.click(screen.getByRole("button", { name: "添加阶段" }));
    await user.click(screen.getAllByRole("button", { name: "删除阶段" })[0]!);
    await user.click(screen.getByRole("button", { name: "Rivals 8队" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
