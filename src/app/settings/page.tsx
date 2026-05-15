import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getUserSession } from "@/lib/auth/session";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { Marker } from "@/components/rivalhub";
import { DisplayNameForm } from "@/components/settings/DisplayNameForm";

export default async function SettingsPage() {
  const session = await getUserSession();
  if (!session) redirect("/login");

  // 读取当前用户的昵称
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
    columns: { displayName: true },
  });

  return (
    <div className="container mx-auto px-4 py-12 max-w-md">
      <div className="space-y-8">
        <div className="space-y-6">
          <Marker>修改昵称</Marker>
          <DisplayNameForm currentDisplayName={user?.displayName} />
        </div>
      </div>
    </div>
  );
}
