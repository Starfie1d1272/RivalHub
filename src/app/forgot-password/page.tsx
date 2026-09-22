import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { PageLayout } from "@/components/rivalhub";

export default function ForgotPasswordPage() {
  return (
    <PageLayout variant="narrow" className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="space-y-1 text-center mb-6">
          <h1 className="font-semibold text-2xl" style={{ fontFamily: "var(--font-display)", color: "var(--color-fg)" }}>
            忘记密码
          </h1>
          <p className="text-sm" style={{ color: "var(--color-fg-mid)" }}>
            输入邮箱，我们会发送重置链接
          </p>
        </div>
        <ForgotPasswordForm />
      </div>
    </PageLayout>
  );
}
