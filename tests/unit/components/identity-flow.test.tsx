/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/auth/LoginForm";
import { EducationVerificationPanel } from "@/components/settings/EducationVerificationPanel";
import { EducationVerificationReviewQueue } from "@/components/admin/EducationVerificationReviewQueue";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/auth", () => ({ loginWithPassword: vi.fn(), signUp: vi.fn(), resendSignupConfirmation: vi.fn(), resendCurrentEmailVerification: vi.fn() }));
vi.mock("@/actions/education-verifications", () => ({ declareInstitutionalEmailEducation: vi.fn(), getInstitutionSearch: vi.fn(), submitEducationVerification: vi.fn(), reviewEducationVerification: vi.fn() }));
vi.mock("@/components/auth/TurnstileWidget", () => ({ TurnstileWidget: () => <div data-testid="turnstile" /> }));

describe("identity flow UI", () => {
  beforeEach(() => { vi.stubGlobal("React", React); vi.stubGlobal("prompt", vi.fn(() => "审核通过")); });

  it("tells a new account that email confirmation is required", () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole("button", { name: "注册" }));
    expect(screen.getByText(/注册后需要验证邮箱/)).toBeInTheDocument();
  });

  it("shows current email and education verification states without evidence URLs", () => {
    render(<EducationVerificationPanel email="player@example.test" emailVerified={false} hasInstitutionalFastPath={false} verifications={[{ id: "1", institution: "南京大学", code: "4132010284", academicStatus: "enrolled", evidenceType: "chsi_enrollment_report", status: "rejected", reviewNote: "学校不一致", submittedAt: new Date().toISOString() }]} />);
    expect(screen.getByText("邮箱尚未验证")).toBeInTheDocument();
    expect(screen.getByText("南京大学 · 在读 · 已驳回")).toBeInTheDocument();
    expect(screen.queryByText(/chsi\.com\.cn/)).not.toBeInTheDocument();
  });

  it("renders the admin review queue with protected new-tab evidence link", () => {
    render(<EducationVerificationReviewQueue rows={[{ id: "11111111-1111-4111-8111-111111111111", email: "player@example.test", displayName: null, institution: "南京大学", code: "4132010284", academicStatus: "graduated", evidenceType: "chsi_education_report", evidenceUrl: "https://www.chsi.com.cn/verify", status: "pending", submittedAt: new Date().toISOString(), reviewNote: null }]} />);
    const link = screen.getByRole("link", { name: /在学信网中打开/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("button", { name: "通过" })).toBeInTheDocument();
  });
});
