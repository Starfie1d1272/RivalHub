import { redirect } from "next/navigation";
import { getUserSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/rivalhub";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";

export default async function ChangePasswordPage() {
  const session = await getUserSession();
  if (!session) redirect("/login");

  return (
    <div className="max-w-md space-y-6">
      <PageHeader title="修改密码" />
      <ChangePasswordForm />
    </div>
  );
}
