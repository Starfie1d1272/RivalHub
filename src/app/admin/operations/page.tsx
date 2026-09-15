import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { PlatformOperationsOverview } from "@/components/admin/PlatformOperationsOverview";
import { requireAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { getPlatformOperationsOverview } from "@/lib/admin/platform-operations/overview";

export default async function PlatformOperationsAdminPage() {
  const admin = await resolveAdminPageAccess(requireAdmin);
  if (!admin) return <AdminAccessDenied />;
  return <PlatformOperationsOverview data={await getPlatformOperationsOverview()} />;
}
