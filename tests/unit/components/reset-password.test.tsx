/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

const { toastErrorMock, updateUserMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  updateUserMock: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: toastErrorMock, success: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/auth/supabase", () => ({
  createBrowserClient: () => ({ auth: { updateUser: updateUserMock } }),
}));

describe("ResetPasswordForm", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.clearAllMocks();
  });

  it("shows the password policy and confirmation field", () => {
    render(<ResetPasswordForm />);

    expect(screen.getByLabelText("确认新密码")).toBeInTheDocument();
    expect(screen.getByText(/至少 6 位，并包含大写字母、小写字母、数字和特殊字符/)).toBeInTheDocument();
  });

  it("rejects a weak replacement password before calling Supabase", () => {
    render(<ResetPasswordForm />);
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "abcdef" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "abcdef" } });
    fireEvent.click(screen.getByRole("button", { name: "设置新密码" }));

    expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining("大写字母、小写字母、数字和特殊字符"));
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});
