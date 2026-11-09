import { ContentReady } from "@/components/telemetry/ContentReady";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { getUserSession } from "@/lib/auth/session";
import { listVerifiedEmailIdentities } from "@/lib/identity/linking";
import { PageHeader, Panel } from "@/components/rivalhub";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import { IdentityManager } from "@/components/settings/IdentityManager";
import { RegistrationReturnLink } from "@/components/settings/RegistrationReturnLink";
import {
  safeRegistrationReturnPath,
  withRegistrationReturnPath,
} from "@/lib/registrations/return-path";

type Props = { searchParams?: Promise<{ returnTo?: string | string[] }> };

export default function AccountSecurityPage(props: Props) {
  return (
    <Suspense
      fallback={
        <p role="status" aria-busy="true">
          正在读取账号资料…
        </p>
      }
    >
      <AccountSecurityContent {...props} />
    </Suspense>
  );
}

async function AccountSecurityContent({ searchParams }: Props) {
  const session = await getUserSession();
  const returnTo = safeRegistrationReturnPath((await searchParams)?.returnTo);
  if (!session) {
    const next = withRegistrationReturnPath("/settings/security", returnTo);
    redirect(`/login?${new URLSearchParams({ next })}`);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="账号与安全"
        description="登录方式可以有多个；赛事历史、教育认证与竞技资料始终归属于同一个 RivalHub 用户。"
      />
      <RegistrationReturnLink href={returnTo} />
      <Suspense
        fallback={
          <Panel label="已验证的邮箱身份">
            <p role="status">正在读取邮箱身份…</p>
          </Panel>
        }
      >
        <VerifiedIdentities userId={session.userId} returnTo={returnTo} />
      </Suspense>
      <Panel label="登录密码" contentClassName="p-5">
        <ContentReady module="account" phase="form" />
        <ChangePasswordForm />
      </Panel>
    </div>
  );
}

async function VerifiedIdentities({
  userId,
  returnTo,
}: {
  userId: string;
  returnTo: string | null;
}) {
  const identities = await listVerifiedEmailIdentities(db, userId);
  return (
    <IdentityManager
      returnTo={returnTo}
      identities={identities.map((identity) => ({
        ...identity,
        verifiedAt: identity.verifiedAt.toISOString(),
      }))}
    />
  );
}
