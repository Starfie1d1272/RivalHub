import Link from "next/link";
import { Settings } from "lucide-react";

interface AdminShortcutProps {
  href: string;
  label?: string;
}

/**
 * 管理员快捷入口按钮。仅在服务端确认管理员身份后渲染。
 */
export function AdminShortcut({ href, label = "管理" }: AdminShortcutProps) {
  return (
    <Link
      href={href as never}
      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] hover:border-[var(--color-border-hi)] transition-colors"
    >
      <Settings size={14} />
      {label}
    </Link>
  );
}
