import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { getUserSession } from "@/lib/auth/session";
import { listVerifiedEmailIdentities } from "@/lib/identity/linking";
import { PageHeader, Panel } from "@/components/rivalhub";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import { IdentityManager } from "@/components/settings/IdentityManager";

export default async function AccountSecurityPage() {
  const session = await getUserSession();
  if (!session) redirect("/login?next=/settings/security");
  const identities = await listVerifiedEmailIdentities(db, session.userId);

  return <div className="max-w-2xl space-y-6">
    <PageHeader title="账号与安全" description="登录方式可以有多个；赛事历史、教育认证与竞技资料始终归属于同一个 RivalHub 用户。" />
    <IdentityManager identities={identities.map((identity) => ({
      ...identity,
      verifiedAt: identity.verifiedAt.toISOString(),
    }))} />
    <Panel label="登录密码" contentClassName="p-5">
      <ChangePasswordForm />
    </Panel>
  </div>;
}
