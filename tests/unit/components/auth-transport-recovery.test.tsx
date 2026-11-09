import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ reset: vi.fn(), verify: vi.fn(), change: vi.fn(), send: vi.fn(), link: vi.fn() }));
vi.mock("@/actions/password-recovery", () => ({ resetUserPassword: mocks.reset, verifyPasswordRecovery: mocks.verify }));
vi.mock("@/actions/account", () => ({ changeUserPassword: mocks.change }));
vi.mock("@/actions/auth", () => ({ sendPasswordResetEmail: mocks.send }));
vi.mock("@/actions/identity", () => ({ requestSecondaryEmailIdentity: mocks.link, revokeSecondaryEmailIdentity: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/telemetry/client", async original => ({ ...await original<typeof import("@/lib/telemetry/client")>(), observeAction: (_name: string, action: unknown) => action }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { IdentityManager } from "@/components/settings/IdentityManager";

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/reset-password");
  mocks.verify.mockResolvedValue({ success: true, data: { email: "fixture@example.test" } });
});
async function enter(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  await user.click(screen.getByLabelText(label));
  await user.paste(value);
}
it.each(["reset", "change"])("blocks a repeated %s after a lost transport response", async flow => {
  const action=flow==="reset"?mocks.reset:mocks.change;
  action.mockRejectedValue(new TypeError("lost response"));
  const user=userEvent.setup();
  if (flow === "reset") window.history.replaceState(null, "", "/reset-password?token=fixture#access_token=fixture&type=recovery");
  render(flow==="reset"?<ResetPasswordForm/>:<ChangePasswordForm/>);
  await screen.findByLabelText("新密码");
  if(flow==="change") await enter(user,"原密码","Original-Password8!");
  await enter(user,"新密码","Recovered-Password7!");
  await enter(user,"确认新密码","Recovered-Password7!");
  await user.click(screen.getByRole("button",{name:flow==="reset"?"设置新密码":"更新密码"}));
  const alert=await screen.findByRole("alert");
  expect(alert).toHaveTextContent("停止提交");
  expect(alert).toHaveTextContent("勿重复");
  const button=screen.getByRole("button",{name:flow==="reset"?"设置新密码":"更新密码"});
  expect(button).toBeDisabled(); await user.click(button); expect(action).toHaveBeenCalledOnce();
});
it("offers a new email when the page opens without a current recovery proof", async () => {
  render(<ResetPasswordForm />);
  expect(await screen.findByRole("link", { name: "重新请求找回邮件" })).toHaveAttribute("href", "/forgot-password");
  expect(screen.queryByLabelText("新密码")).not.toBeInTheDocument();
  expect(mocks.verify).not.toHaveBeenCalled();
});
it("keeps email entry usable and gives unknown-delivery guidance without resending",async()=>{
 mocks.send.mockRejectedValue(new TypeError("lost response")); const user=userEvent.setup(); render(<ForgotPasswordForm/>);
 await enter(user,"邮箱地址","synthetic@example.test"); await user.click(screen.getByRole("button",{name:"发送重置链接"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("先检查收件箱"); expect(mocks.send).toHaveBeenCalledOnce();
 expect(screen.getByRole("button",{name:"发送重置链接"})).toBeEnabled();
});
it("retains a pending identity mail after an explicitly unknown provider result",async()=>{
 mocks.link.mockResolvedValue({success:false,error:{code:"INTERNAL_ERROR",message:"发送情况未知，先查邮箱",meta:{outcome:"unknown"}}});
 const user=userEvent.setup();render(<IdentityManager identities={[]}/>);
 await enter(user,"邮箱","synthetic@example.test");await user.click(screen.getByRole("button",{name:"发送验证邮件"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("先查邮箱");expect(screen.getByRole("button",{name:"发送验证邮件"})).toBeDisabled();expect(mocks.link).toHaveBeenCalledOnce();
});
