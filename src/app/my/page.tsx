import { redirect } from "next/navigation";
import { MyReadinessDashboard } from "@/components/my/MyReadinessDashboard";
import { getUserSession } from "@/lib/auth/session";
import { loadMyReadiness } from "@/lib/my/readiness";

export default async function MyPage() {
  const session = await getUserSession();
  if (!session) redirect("/login?next=/my");
  return <MyReadinessDashboard model={await loadMyReadiness(session.userId)} />;
}
