import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// A cross-layer test is needed here: separately mocked action/component tests
// missed actionError replacing the fence's recovery guidance with refresh copy.
// Real form -> action -> password owner -> actionError -> UI; only external
// Auth, DB transaction and cookie boundaries are stubbed. PG owns fence locks.
const mocks = vi.hoisted(() => ({
  begin: vi.fn(), finish: vi.fn(), audit: vi.fn(), update: vi.fn(), destroy: vi.fn(), signIn: vi.fn(), createSession: vi.fn(),
  replace: vi.fn(), refresh: vi.fn(), signOut: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn(),
}));
vi.mock("@/db/client", () => ({ db: {
  transaction: async (run: (tx: unknown) => unknown) => run("tx"),
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ userId: "canonical" }] }) }) }),
  query: { users: { findFirst: async () => ({ authId: "auth-subject" }) } },
} }));
vi.mock("@/lib/auth/session-registry", () => ({ beginAuthentication: async () => "proof", beginPasswordMutationInTx: mocks.begin, finishPasswordMutationInTx: mocks.finish }));
vi.mock("@/lib/audit/write", () => ({ writeAuditInTx: mocks.audit }));
vi.mock("@/lib/auth/session", () => ({ requireAuth: async () => ({ userId: "canonical", email: "fixture@local.test" }), destroyUserSession: mocks.destroy, createUserSession: mocks.createSession }));
vi.mock("@/lib/auth/supabase-server", () => ({
  createPublicAuthClient: () => ({ auth: {
    getUser: async () => ({ data: { user: { id: "auth-subject" } }, error: null }),
    signInWithPassword: mocks.signIn,
  } }),
  createServiceClient: () => ({ auth: { admin: { updateUserById: mocks.update } } }),
}));
vi.mock("@/lib/auth/supabase", () => ({ createBrowserClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "fixture-access-token" } } }), signOut: mocks.signOut } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import { LoginForm } from "@/components/auth/LoginForm";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.begin.mockResolvedValue("mutation-id");
  mocks.signIn.mockResolvedValue({ data: { user: { id: "auth-subject" } }, error: null });
});

describe("password unknown outcome reaches the real UI", () => {
  it("definite rejection finishes the fence and offers re-login without claiming success", async () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    mocks.update.mockResolvedValue({ error: { status: 422, code: "weak_password", message: "raw-private-body" } });
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    await user.type(screen.getByLabelText("新密码"), "Recovered-Password7!");
    await user.type(screen.getByLabelText("确认新密码"), "Recovered-Password7!");
    await user.click(screen.getByRole("button", { name: "设置新密码" }));
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining("重新登录后重试"));
    expect(mocks.finish).toHaveBeenCalledOnce();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(JSON.parse(String(write.mock.calls[0][0]))).toMatchObject({ errorClass: "expected", safeContext: { outcome: "rejected", httpStatus: 422 } });
    expect(JSON.stringify(write.mock.calls)).not.toContain("raw-private-body");
    write.mockRestore();
  });
  it("login displays the owner's rate-limit guidance and retains manual retry", async () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    mocks.signIn.mockResolvedValue({ data: { user: null }, error: { status: 429 } });
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.type(screen.getByLabelText("邮箱地址"), "fixture@local.test");
    await user.type(screen.getByLabelText("密码"), "Fixture-Password7!");
    const submit = screen.getAllByRole("button", { name: "登录" }).find(button => button.getAttribute("type") === "submit")!;
    await user.click(submit);
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining("等待几分钟后再试"));
    expect(submit).toBeEnabled();
    expect(mocks.createSession).not.toHaveBeenCalled();
    await user.click(submit);
    expect(mocks.signIn).toHaveBeenCalledTimes(2);
    write.mockRestore();
  });
  it.each(["reset", "change"])("%s preserves admin guidance, correlation and the pending fence", async (flow) => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const cause = Object.assign(new Error("fixture-access-token Recovered-Password7! raw-private-body"), { code: "ETIMEDOUT" });
    mocks.update.mockRejectedValue(cause);
    const user = userEvent.setup();
    render(flow === "reset" ? <ResetPasswordForm /> : <ChangePasswordForm />);
    if (flow === "change") await user.type(screen.getByLabelText("原密码"), "Original-Password8!");
    await user.type(screen.getByLabelText("新密码"), "Recovered-Password7!");
    await user.type(screen.getByLabelText("确认新密码"), "Recovered-Password7!");
    const submit = screen.getByRole("button", { name: flow === "reset" ? "设置新密码" : "更新密码" });
    await user.click(submit);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("登录已暂停");
    expect(alert).toHaveTextContent("请联系平台管理员");
    expect(alert).toHaveTextContent("操作时间和排查编号");
    expect(alert).not.toHaveTextContent("刷新确认");
    expect(submit).toBeDisabled();
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(mocks.destroy).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledOnce();
    const log = JSON.parse(String(write.mock.calls[0][0]));
    expect(log).toMatchObject({ event: "auth.password_update.failure", errorClass: "dependency", retryable: false, safeContext: { outcome: "unknown" }, exception: { cause: { name: "Error", code: "ETIMEDOUT" } } });
    expect(alert).toHaveTextContent(log.requestId);
    expect(JSON.stringify([log, alert.textContent])).not.toMatch(/raw-private-body|fixture-access-token|Recovered-Password7/);
    write.mockRestore();
  });
});
