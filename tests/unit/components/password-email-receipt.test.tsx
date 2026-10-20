import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn(), error: vi.fn() }));
vi.mock("@/actions/auth", () => ({ sendPasswordResetEmail: mocks.send }));
vi.mock("@/lib/telemetry/client", () => ({ observeAction: (_name: string, action: unknown) => action }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

beforeEach(() => vi.clearAllMocks());

// The response must identify the submitted destination, even if the input changes
// while the request is in flight. No provider or real email is used here.
it("keeps the reset-email receipt bound to the submitted address", async () => {
  let complete!: (result: { success: true }) => void;
  mocks.send.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  const user = userEvent.setup();
  render(<ForgotPasswordForm />);
  const email = screen.getByLabelText("邮箱地址");
  await user.type(email, "submitted@example.test");
  await user.click(screen.getByRole("button", { name: "发送重置链接" }));
  await user.clear(email);
  await user.type(email, "edited@example.test");
  await act(async () => complete({ success: true }));
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith("submitted@example.test");
  expect(screen.getByText(/请查看邮箱 submitted@example\.test/)).toBeTruthy();
  expect(screen.queryByText(/请查看邮箱 edited@example\.test/)).toBeNull();
});

it("keeps the editable address and safe recovery message after a rejected request", async () => {
  mocks.send.mockResolvedValue({ success: false, error: { message: "暂时无法发送，请稍后重试。" } });
  const user = userEvent.setup();
  render(<ForgotPasswordForm />);
  await user.type(screen.getByLabelText("邮箱地址"), "submitted@example.test");
  await user.click(screen.getByRole("button", { name: "发送重置链接" }));
  expect(mocks.error).toHaveBeenCalledWith("暂时无法发送，请稍后重试。");
  expect(screen.queryByText("重置链接已发送")).toBeNull();
  expect(screen.getByLabelText("邮箱地址")).toHaveProperty("value", "submitted@example.test");
});
