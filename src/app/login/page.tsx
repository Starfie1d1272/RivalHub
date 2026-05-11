import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">选手登录</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            使用邮箱和密码登录
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
