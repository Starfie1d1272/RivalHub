import { redirect } from "next/navigation";
import { getUserSession } from "@/lib/auth/session";
import { Marker } from "@/components/rivalhub";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";

export default async function ChangePasswordPage() {
  const session = await getUserSession();
  if (!session) redirect("/login");

  return (
    <div className="max-w-md space-y-6">
      <Marker>修改密码</Marker>
      <ChangePasswordForm />
    </div>
  );
}
