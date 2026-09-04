/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/auth/LoginForm";
import { EducationVerificationPanel } from "@/components/settings/EducationVerificationPanel";
import { EducationVerificationReviewQueue } from "@/components/admin/EducationVerificationReviewQueue";

const { loginWithPasswordMock, resendSignupConfirmationMock, getInstitutionSearchMock, submitEducationVerificationMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  loginWithPasswordMock: vi.fn(),
  resendSignupConfirmationMock: vi.fn(),
  getInstitutionSearchMock: vi.fn(),
  submitEducationVerificationMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));
vi.mock("@/actions/auth", () => ({ loginWithPassword: loginWithPasswordMock, signUp: vi.fn(), resendSignupConfirmation: resendSignupConfirmationMock, resendCurrentEmailVerification: vi.fn() }));
vi.mock("@/actions/education-verifications", () => ({ declareInstitutionalEmailEducation: vi.fn(), getInstitutionSearch: getInstitutionSearchMock, submitEducationVerification: submitEducationVerificationMock, reviewEducationVerification: vi.fn() }));
vi.mock("@/components/auth/TurnstileWidget", () => ({ TurnstileWidget: () => <div data-testid="turnstile" /> }));

describe("identity flow UI", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("React", React); vi.stubGlobal("prompt", vi.fn(() => "审核通过")); });

  it("tells a new account that email confirmation is required", () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole("button", { name: "注册" }));
    expect(screen.getByText(/注册后需要验证邮箱/)).toBeInTheDocument();
  });

  it("shows the production password policy and confirmation field during signup", () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole("button", { name: "注册" }));

    expect(screen.getByLabelText("确认密码")).toBeInTheDocument();
    expect(screen.getByText(/至少 6 位，并包含大写字母、小写字母、数字和特殊字符/)).toBeInTheDocument();
  });

  it("takes a correctly authenticated unverified user to the resend path", async () => {
    loginWithPasswordMock.mockResolvedValue({
      success: false,
      error: { code: "EMAIL_NOT_CONFIRMED", message: "邮箱尚未验证" },
    });
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("邮箱地址"), { target: { value: "player@example.test" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "Aa1!xx" } });
    fireEvent.click(screen.getAllByRole("button", { name: "登录" })[1]);

    expect(await screen.findByRole("button", { name: "重新发送验证邮件" })).toBeInTheDocument();
    expect(screen.getByText(/检查垃圾邮件、广告邮件或其它分类/)).toBeInTheDocument();
  });

  it("after a successful resend, disables repeated sends for the configured cooldown", async () => {
    loginWithPasswordMock.mockResolvedValue({
      success: false,
      error: { code: "EMAIL_NOT_CONFIRMED", message: "邮箱尚未验证" },
    });
    resendSignupConfirmationMock.mockResolvedValue({ success: true, data: undefined });
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("邮箱地址"), { target: { value: "player@example.test" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "Aa1!xx" } });
    fireEvent.click(screen.getAllByRole("button", { name: "登录" })[1]);
    const resend = await screen.findByRole("button", { name: "重新发送验证邮件" });
    fireEvent.click(resend);

    await waitFor(() => expect(resendSignupConfirmationMock).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    await waitFor(() => expect(screen.getByRole("button", { name: "请等待 60 秒后重试" })).toBeDisabled(), { timeout: 5_000 });
  });

  it("shows current email and education verification states without evidence URLs", () => {
    render(<EducationVerificationPanel email="player@example.test" emailVerified={false} hasInstitutionalFastPath={false} verifications={[{ id: "1", institution: "南京大学", code: "4132010284", academicStatus: "enrolled", evidenceType: "chsi_enrollment_report", status: "rejected", reviewNote: "学校不一致", submittedAt: new Date().toISOString() }]} />);
    expect(screen.getByText("邮箱尚未验证")).toBeInTheDocument();
    expect(screen.getByText("南京大学 · 在读 · 已驳回")).toBeInTheDocument();
    expect(screen.getByText("审核说明：学校不一致")).toBeInTheDocument();
    expect(screen.queryByText(/chsi\.com\.cn/)).not.toBeInTheDocument();
  });

  it("keeps school search, selection, reset, and submission tied to the selected institution", async () => {
    getInstitutionSearchMock.mockResolvedValue({ success: true, data: [{ id: "institution-1", name: "南京大学", code: "4132010284", province: "江苏" }] });
    submitEducationVerificationMock.mockResolvedValue({ success: true, data: "created" });
    render(<EducationVerificationPanel email="player@example.test" emailVerified hasInstitutionalFastPath={false} verifications={[]} />);

    expect(screen.getByLabelText("学校")).toBeInTheDocument();
    expect(screen.getByText("输入学校名称，并从教育部高校目录搜索结果中选择")).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "提交认证材料" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("学校"), { target: { value: "南京" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索高校" }));
    const result = await screen.findByRole("button", { name: /南京大学/ });
    expect(screen.getByText(/江苏 · 高校代码 4132010284/)).toBeInTheDocument();
    fireEvent.click(result);

    expect(screen.getByRole("status")).toHaveTextContent("南京大学");
    expect(screen.getByRole("status")).toHaveTextContent("江苏 · 高校代码 4132010284");
    expect(screen.getByRole("button", { name: "重新选择" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "已毕业" }));
    fireEvent.change(screen.getByLabelText("学信网在线验证码"), { target: { value: "ABCD1234EFGH5678" } });
    expect(submit).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新选择" }));

    expect(screen.getByLabelText("学校")).toHaveValue("南京大学");
    expect(screen.getByLabelText("学信网在线验证码")).toHaveValue("ABCD1234EFGH5678");
    expect(screen.getByRole("button", { name: "已毕业" })).toBeInTheDocument();
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "搜索高校" }));
    fireEvent.click(await screen.findByRole("button", { name: /南京大学/ }));
    fireEvent.click(submit);
    await waitFor(() => expect(submitEducationVerificationMock).toHaveBeenCalledWith({ institutionId: "institution-1", academicStatus: "graduated", evidenceCode: "ABCD1234EFGH5678" }));
  });

  it("shows an already-approved outcome instead of a pending-submission toast", async () => {
    getInstitutionSearchMock.mockResolvedValue({ success: true, data: [{ id: "institution-1", name: "南京大学", code: "4132010284", province: "江苏" }] });
    submitEducationVerificationMock.mockResolvedValue({ success: true, data: "already_approved" });
    render(<EducationVerificationPanel email="player@example.test" emailVerified hasInstitutionalFastPath={false} verifications={[]} />);

    fireEvent.change(screen.getByLabelText("学校"), { target: { value: "南京" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索高校" }));
    fireEvent.click(await screen.findByRole("button", { name: /南京大学/ }));
    fireEvent.change(screen.getByLabelText("学信网在线验证码"), { target: { value: "ABCD1234EFGH5678" } });
    fireEvent.click(screen.getByRole("button", { name: "提交认证材料" }));

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith("该验证码已通过审核，无需重复提交"));
    expect(toastSuccessMock).not.toHaveBeenCalledWith("教育认证已提交，等待管理员审核");
  });

  it("renders the admin review queue with a protected CHSI verification path", () => {
    render(<EducationVerificationReviewQueue rows={[{ id: "11111111-1111-4111-8111-111111111111", email: "player@example.test", displayName: null, institution: "南京大学", code: "4132010284", academicStatus: "graduated", evidenceType: "chsi_education_report", evidenceCode: "ABCD1234EFGH5678", status: "pending", submittedAt: new Date().toISOString(), reviewNote: null }]} />);
    const link = screen.getByRole("link", { name: /在学信网核验/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("ABCD1234EFGH5678")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制验证码" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "通过" })).toBeInTheDocument();
  });

  it("shows cleared CHSI evidence as a retention-policy state", () => {
    render(<EducationVerificationReviewQueue rows={[{ id: "22222222-2222-4222-8222-222222222222", email: "player@example.test", displayName: null, institution: "南京大学", code: "4132010284", academicStatus: "graduated", evidenceType: "chsi_education_report", evidenceCode: null, status: "approved", submittedAt: new Date().toISOString(), reviewNote: null }]} />);

    expect(screen.getByText("在线验证码：已按保留策略清理")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制验证码" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /在学信网核验/ })).not.toBeInTheDocument();
  });
});
