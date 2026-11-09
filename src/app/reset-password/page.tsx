import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { PageLayout } from "@/components/rivalhub";

export default function ResetPasswordPage() {
  return (
    <PageLayout variant="narrow" className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1
            className="font-semibold text-2xl"
            style={{ fontFamily: "var(--font-display)", color: "var(--color-fg)" }}
          >
            找回密码
          </h1>
        </div>
        <ResetPasswordForm />
      </div>
    </PageLayout>
  );
}
