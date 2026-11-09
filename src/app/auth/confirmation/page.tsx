import Link from "next/link";
import { EmailConfirmationForm } from "@/components/auth/EmailConfirmationForm";
import { SecondaryIdentityConfirmationForm } from "@/components/auth/SecondaryIdentityConfirmationForm";
import { PageLayout } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { db } from "@/db/client";
import { secondaryEmailLinkProofSchema } from "@/lib/auth/secondary-email-otp";
import { getUserSession } from "@/lib/auth/session";
import { ErrorCode, isAppErrorCode } from "@/lib/errors";
import { assertSecondaryEmailLinkReady } from "@/lib/identity/linking";
import { safeRegistrationReturnPath, withRegistrationReturnPath } from "@/lib/registrations/return-path";

export const instant = false;

export default async function ConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{
    flow?: string;
    token_hash?: string;
    next?: string;
    request?: string;
    state?: string;
    type?: string;
    returnTo?: string | string[];
  }>;
}) {
  const { flow, token_hash: tokenHash, next, request, state, type, returnTo } = await searchParams;
  const confirmationFlow = flow === "signup" || flow === "reverify" ? flow : null;

  return (
    <PageLayout variant="narrow" className="min-h-screen flex items-center justify-center">
      <section className="w-full max-w-sm space-y-4 rounded-sm border border-[var(--color-border)] p-5 text-center">
        {flow === "link_identity" ? (
          <>
            <h1 className="text-xl font-semibold">确认绑定身份</h1>
            <SecondaryEmailLink
              proof={{ tokenHash, requestId: request, stateToken: state, otpType: type }}
              returnTo={safeRegistrationReturnPath(returnTo)}
            />
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
            <Link
              href="/login"
              className="inline-flex text-sm underline hover:text-[var(--color-accent)]"
            >
              返回登录
            </Link>
          </>
        )}
      </section>
    </PageLayout>
  );
}

async function SecondaryEmailLink({ proof, returnTo }: { proof: unknown; returnTo: string | null }) {
  const session = await getUserSession();
  if (!session) {
    return (
      <SecondaryEmailLinkMessage returnTo={returnTo} message="请登录发起绑定的 RivalHub 账号，再从邮件重新打开此链接。" />
    );
  }

  const parsed = secondaryEmailLinkProofSchema.safeParse(proof);
  if (!parsed.success) {
    return (
      <SecondaryEmailLinkMessage signedIn returnTo={returnTo} message="邮箱绑定链接无效，请在账号与安全中重新发起。" />
    );
  }

  const { requestId, stateToken } = parsed.data;
  try {
    await assertSecondaryEmailLinkReady(db, {
      requestId,
      stateToken,
      currentUserId: session.userId,
    });
  } catch (error) {
    if (
      isAppErrorCode(error, ErrorCode.FORBIDDEN) ||
      isAppErrorCode(error, ErrorCode.VALIDATION_FAILED)
    ) {
      return <SecondaryEmailLinkMessage signedIn returnTo={returnTo} message={error.message} />;
    }
    throw error;
  }

  return (
    <>
      <p className="text-sm text-[var(--color-fg-mid)]">
        点击后将验证这个邮箱。若它已属于另一个 RivalHub 账号，你可以先查看归并影响，再决定是否继续。
      </p>
      <SecondaryIdentityConfirmationForm {...parsed.data} returnTo={returnTo} />
    </>
  );
}

function SecondaryEmailLinkMessage({
  message,
  signedIn = false,
  returnTo,
}: {
  message: string;
  signedIn?: boolean;
  returnTo: string | null;
}) {
  const securityHref = withRegistrationReturnPath("/settings/security", returnTo);
  const loginHref = returnTo ? `/login?${new URLSearchParams({ next: securityHref })}` : "/login";
  return (
    <>
      <p role="alert" className="text-sm text-[var(--color-fg-mid)]">
        {message}
      </p>
      <Button asChild variant="outline" className="w-full">
        <Link href={(signedIn ? securityHref : loginHref) as never} prefetch={false}>
          {signedIn ? "查看当前账号" : "去登录"}
        </Link>
      </Button>
    </>
  );
}
