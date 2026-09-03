import { getCurrentUserAuthorization } from "@/lib/auth/session";
import { AdminShortcut } from "./AdminShortcut";

export async function AdminShortcutSlot({
  href,
  label,
}: {
  href: string;
  label?: string;
}) {
  const authorization = await getCurrentUserAuthorization();
  if (!authorization) return null;

  const isAdmin =
    authorization.role === "super_admin" || authorization.seasonIds.length > 0;
  return isAdmin ? <AdminShortcut href={href} label={label} /> : null;
}
