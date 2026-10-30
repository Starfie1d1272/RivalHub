import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import type { LoginForm as LoginFormType } from "@/components/auth/LoginForm";
let LoginForm: typeof LoginFormType;
import { resetTelemetryIdentity } from "@/lib/telemetry/client";

const actions = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn(), resend: vi.fn(), error: vi.fn() }));
vi.mock("@/actions/auth", () => ({ loginWithPassword: actions.login, signUp: actions.register, resendSignupConfirmation: actions.resend }));
vi.mock("sonner", () => ({ toast: { error: actions.error } }));
vi.mock("@/components/auth/TurnstileWidget", () => ({ TurnstileWidget: ({ onVerify }: { onVerify: (token: string) => void }) => <button type="button" onClick={() => onVerify("fixture-provider-token")}>合成验证</button> }));
beforeEach(async () => { vi.resetModules(); ({ LoginForm } = await import("@/components/auth/LoginForm")); });
afterEach(() => { cleanup(); resetTelemetryIdentity(); vi.unstubAllGlobals(); sessionStorage.clear(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it("requires an explicit update, preserves only email and never replays the rejected login", async () => {
  actions.login.mockRejectedValue(new UnrecognizedActionError("fixture"));
  const user = userEvent.setup(); const view = render(<LoginForm />);
  await user.type(screen.getByLabelText("邮箱地址"), "local@example.test");
  await user.type(screen.getByLabelText("密码", { exact: true }), "PrivatePassword123!");
  await user.click(screen.getAllByRole("button", { name: "登录" }).at(-1)!);
  expect(await screen.findByRole("status")).toHaveTextContent("页面版本已更新");
  expect(screen.getByLabelText("密码", { exact: true })).toHaveValue("");
  expect(sessionStorage.length).toBe(0);
  expect(screen.getAllByRole("button", { name: "登录" }).at(-1)).toBeDisabled();
  const reload = vi.fn();
  const originalWindow = window;
  vi.stubGlobal("window", new Proxy(originalWindow, { get(target, key) { return key === "location" ? { reload } : Reflect.get(target, key, target); } }));
  await user.click(screen.getByRole("button", { name: "保留邮箱并更新页面" }));
  expect(reload).toHaveBeenCalledOnce(); expect(actions.login).toHaveBeenCalledTimes(1);
  const stored = JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!);
  expect(Object.keys(stored).sort()).toEqual(["email", "expiresAt"]);
  expect(stored.email).toBe("local@example.test");
  expect(JSON.stringify(stored)).not.toContain("PrivatePassword");
  vi.unstubAllGlobals(); view.unmount(); render(<LoginForm />);
  expect(await screen.findByLabelText("邮箱地址")).toHaveValue("local@example.test");
  expect(screen.getByLabelText("密码", { exact: true })).toHaveValue("");
  expect(actions.login).toHaveBeenCalledTimes(1); expect(sessionStorage.length).toBe(0);
});

it("clears both registration passwords and does not preserve a provider token on version mismatch", async () => {
  actions.register.mockRejectedValue(new UnrecognizedActionError("fixture"));
  const user = userEvent.setup(); render(<LoginForm initialMode="register" />);
  await user.type(screen.getByLabelText("邮箱地址"), "local@example.test");
  await user.type(screen.getByLabelText("密码", { exact: true }), "PrivatePassword123!");
  await user.type(screen.getByLabelText("确认密码"), "PrivatePassword123!");
  await user.click(screen.getByRole("button", { name: "合成验证" }));
  await user.click(screen.getAllByRole("button", { name: "注册" }).at(-1)!);
  expect(await screen.findByRole("status")).toHaveTextContent("页面版本已更新");
  expect(screen.getByLabelText("密码", { exact: true })).toHaveValue("");
  expect(screen.getByLabelText("确认密码")).toHaveValue("");
  expect(screen.getAllByRole("button", { name: "注册" }).at(-1)).toBeDisabled();
  expect(actions.register).toHaveBeenCalledTimes(1); expect(sessionStorage.length).toBe(0);
});

it("offers the same explicit recovery for a missing resend action without resending", async () => {
  actions.login.mockResolvedValue({ success: false, error: { code: "EMAIL_NOT_CONFIRMED", message: "fixture" } });
  actions.resend.mockRejectedValue(new UnrecognizedActionError("fixture"));
  const user = userEvent.setup(); render(<LoginForm />);
  await user.type(screen.getByLabelText("邮箱地址"), "local@example.test");
  await user.type(screen.getByLabelText("密码", { exact: true }), "PrivatePassword123!");
  await user.click(screen.getAllByRole("button", { name: "登录" }).at(-1)!);
  await user.click(await screen.findByRole("button", { name: "重新发送验证邮件" }));
  expect(await screen.findByRole("status")).toHaveTextContent("页面版本已更新");
  expect(screen.getByRole("button", { name: "重新发送验证邮件" })).toBeDisabled();
  expect(actions.resend).toHaveBeenCalledTimes(1); expect(sessionStorage.length).toBe(0);
});

it("keeps a transport error distinct and does not offer version recovery or replay", async () => {
  actions.login.mockRejectedValue(new TypeError("Failed to fetch"));
  const user = userEvent.setup(); render(<LoginForm />);
  await user.type(screen.getByLabelText("邮箱地址"), "local@example.test");
  await user.type(screen.getByLabelText("密码", { exact: true }), "PrivatePassword123!");
  await user.click(screen.getAllByRole("button", { name: "登录" }).at(-1)!);
  await vi.waitFor(() => expect(actions.error).toHaveBeenCalled());
  expect(screen.queryByRole("status")).toBeNull();
  expect(actions.login).toHaveBeenCalledTimes(1); expect(sessionStorage.length).toBe(0);
});

it("keeps the page and email usable when explicit update cannot preserve the email", async () => {
  actions.login.mockRejectedValue(new UnrecognizedActionError("fixture"));
  const user = userEvent.setup(); render(<LoginForm />);
  await user.type(screen.getByLabelText("邮箱地址"), "local@example.test");
  await user.type(screen.getByLabelText("密码", { exact: true }), "PrivatePassword123!");
  await user.click(screen.getAllByRole("button", { name: "登录" }).at(-1)!);
  await screen.findByRole("status");
  const reload = vi.fn(); const originalWindow = window;
  vi.stubGlobal("window", new Proxy(originalWindow, { get(target, key) { return key === "location" ? { reload } : Reflect.get(target, key, target); } }));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("fixture unavailable"); });
  await user.click(screen.getByRole("button", { name: "保留邮箱并更新页面" }));
  expect(reload).not.toHaveBeenCalled();
  expect(actions.error).toHaveBeenCalledWith("无法保留邮箱草稿，请复制邮箱后刷新页面。");
  expect(screen.getByLabelText("邮箱地址")).toHaveValue("local@example.test");
  expect(screen.getByLabelText("密码", { exact: true })).toHaveValue("");
  expect(actions.login).toHaveBeenCalledTimes(1);
});

it("uses email recovery when a background action detects the update", async () => {
  const user = userEvent.setup(); render(<LoginForm />);
  await user.type(screen.getByLabelText("邮箱地址"), "local@example.test");
  await user.type(screen.getByLabelText("密码", { exact: true }), "PrivatePassword123!");
  const { reportDeploymentUpdate } = await import("@/lib/deployment-update");
  act(() => { reportDeploymentUpdate(new UnrecognizedActionError("fixture")); });
  expect(screen.getByLabelText("密码", { exact: true })).toHaveValue("");
  expect(screen.getByLabelText("邮箱地址")).toHaveValue("local@example.test");
  expect(screen.getByRole("button", { name: "保留邮箱并更新页面" })).toBeInTheDocument();
  expect(actions.login).not.toHaveBeenCalled();
});
