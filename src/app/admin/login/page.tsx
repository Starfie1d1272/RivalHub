import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import Link from "next/link";

export default function AdminLoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            管理员登录
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            首次使用请先运行{" "}
            <code className="text-xs bg-[var(--bg-elevated)] px-1 rounded">
              pnpm seed
            </code>{" "}
            创建根管理员
          </p>
        </div>
        <AdminLoginForm />
        <p className="text-center text-sm text-[var(--text-secondary)]">
          没有账户？{" "}
          <Link
            href="/admin/register"
            className="underline hover:text-[var(--text-primary)]"
          >
            使用邀请码注册
          </Link>
        </p>
      </div>
    </div>
  );
}
