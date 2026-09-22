import Link from "next/link";
import { EmailConfirmationForm } from "@/components/auth/EmailConfirmationForm";
import { SecondaryIdentityConfirmationForm } from "@/components/auth/SecondaryIdentityConfirmationForm";
import { PageLayout } from "@/components/rivalhub";
import { isSecondaryEmailOtpType } from "@/lib/auth/secondary-email-otp";

export const instant = false;

export default async function ConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ flow?: string; token_hash?: string; next?: string; request?: string; state?: string; type?: string }>;
}) {
  const { flow, token_hash: tokenHash, next, request, state, type } = await searchParams;
  const confirmationFlow = flow === "signup" || flow === "reverify" ? flow : null;
  const identityLink = flow === "link_identity" && tokenHash && request && state && isSecondaryEmailOtpType(type)
    ? { tokenHash, requestId: request, stateToken: state, otpType: type }
    : null;

  return (
    <PageLayout variant="narrow" className="min-h-screen flex items-center justify-center">
      <section className="w-full max-w-sm space-y-4 rounded-sm border border-[var(--color-border)] p-5 text-center">
        {identityLink ? (
          <>
            <h1 className="text-xl font-semibold">确认绑定身份</h1>
            <p className="text-sm text-[var(--color-fg-mid)]">
              点击后将验证这个邮箱。若它已属于另一个 RivalHub 账号，系统会先生成安全归并预检，不会直接改写数据。
            </p>
            <SecondaryIdentityConfirmationForm {...identityLink} />
          </>
        ) : confirmationFlow && tokenHash ? (
          <>
            <h1 className="text-xl font-semibold">确认邮箱</h1>
            <p className="text-sm text-[var(--color-fg-mid)]">
              请确认这是你本人发起的操作。点击下方按钮后，RivalHub 才会验证邮箱并登录。
            </p>
            <EmailConfirmationForm flow={confirmationFlow} tokenHash={tokenHash} next={next} />
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">邮箱验证未完成</h1>
            <p className="text-sm text-[var(--color-fg-mid)]">
              验证链接可能已失效或已被使用。请返回登录，使用原邮箱和密码登录后重新发送验证邮件。
            </p>
            <Link href="/login" className="inline-flex text-sm underline hover:text-[var(--color-accent)]">
              返回登录
            </Link>
          </>
        )}
      </section>
    </PageLayout>
  );
}
