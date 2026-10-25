import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { LoginForm } from "@/components/auth/LoginForm";
import { preserveLoginUpdateEmail, takeLoginUpdateEmail } from "@/lib/auth/login-update-draft";

const login = vi.hoisted(() => vi.fn());
vi.mock("@/actions/auth", () => ({ loginWithPassword: login, resendSignupConfirmation: vi.fn(), signUp: vi.fn() }));
vi.mock("@/components/auth/TurnstileWidget", () => ({ TurnstileWidget: () => null }));
vi.mock("@/components/telemetry/TaskBoundary", () => ({ TaskBoundary: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/telemetry/client", () => ({ observeAction: (_: string, action: unknown) => action, beginTelemetryTask: vi.fn(), completeTelemetryTask: vi.fn(), recordTaskValidation: vi.fn() }));
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); login.mockReset(); });

it("recognizes a missing server action, clears credentials and requires an explicit update without replay", async () => {
  const user = userEvent.setup();
  login.mockRejectedValue(new UnrecognizedActionError("fixture missing action"));
  render(<LoginForm />);
  await user.type(screen.getByLabelText("邮箱地址"), "local@example.test");
  await user.type(screen.getByLabelText("密码", { exact: true }), "FixturePassword123!");
  await user.click(screen.getAllByRole("button", { name: "登录" }).at(-1)!);
  expect(await screen.findByRole("status")).toHaveTextContent("页面版本已更新");
  expect(screen.getByLabelText("密码", { exact: true })).toHaveValue("");
  expect(screen.getByLabelText("邮箱地址")).toHaveValue("local@example.test");
  expect(login).toHaveBeenCalledTimes(1);
  expect(sessionStorage.length).toBe(0);
  expect(screen.getAllByRole("button", { name: "登录" }).at(-1)).toBeDisabled();
});

it("stores only an email and expiry, consumes once, and rejects stale drafts", () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  expect(preserveLoginUpdateEmail("local@example.test")).toBe(true);
  const raw = JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!);
  expect(Object.keys(raw).sort()).toEqual(["email", "expiresAt"]);
  expect(takeLoginUpdateEmail()).toBe("local@example.test");
  expect(takeLoginUpdateEmail()).toBeNull();
  preserveLoginUpdateEmail("local@example.test");
  vi.mocked(Date.now).mockReturnValue(1000 + 15 * 60_000);
  expect(takeLoginUpdateEmail()).toBeNull();
  expect(sessionStorage.length).toBe(0);
});

it("restores only the email after an explicit update, leaving the password empty", async () => {
  preserveLoginUpdateEmail("local@example.test");
  render(<LoginForm />);
  expect(await screen.findByLabelText("邮箱地址")).toHaveValue("local@example.test");
  expect(screen.getByLabelText("密码", { exact: true })).toHaveValue("");
  expect(login).not.toHaveBeenCalled();
});
