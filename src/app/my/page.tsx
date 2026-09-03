import { redirect } from "next/navigation";
import { MyReadinessDashboard } from "@/components/my/MyReadinessDashboard";
import { getUserSession } from "@/lib/auth/session";
import { loadMyReadiness } from "@/lib/my/readiness";

// Authenticated dashboard state is request-bound. Keep this route blocking so
// Cache Components never tries to validate it as an instant navigation target.
export const instant = false;

export default async function MyPage() {
  const session = await getUserSession();
  if (!session) redirect("/login?next=/my");
  return <MyReadinessDashboard model={await loadMyReadiness(session.userId)} />;
}
