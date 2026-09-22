import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { PageLayout } from "@/components/rivalhub";

export default function ResetPasswordPage() {
  return (
    <PageLayout variant="narrow" className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="space-y-1 text-center mb-6">
          <h1 className="font-semibold text-2xl" style={{ fontFamily: "var(--font-display)", color: "var(--color-fg)" }}>
            设置新密码
          </h1>
          <p className="text-sm" style={{ color: "var(--color-fg-mid)" }}>请输入你的新密码</p>
        </div>
        <ResetPasswordForm />
      </div>
    </PageLayout>
  );
}
