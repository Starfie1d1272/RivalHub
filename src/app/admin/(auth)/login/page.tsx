import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import Link from "next/link";

export default function AdminLoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-[var(--color-fg)]">
            管理员登录
          </h1>
          <p className="text-sm text-[var(--color-fg-mid)]">
            标准首个 owner 请通过{" "}
            <Link href="/login" className="underline hover:text-[var(--color-accent)]">
              /login
            </Link>{" "}
            注册并登录；本页仅保留 legacy Root 兼容/应急入口。
          </p>
        </div>
        <AdminLoginForm />
      </div>
    </div>
  );
}
