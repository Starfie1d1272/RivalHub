import { LoginForm } from "@/components/auth/LoginForm";
import { Panel } from "@/components/rivalhub";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Panel className="w-full max-w-sm">
        <div className="space-y-1 text-center mb-6">
          <h1
            className="font-semibold"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 24,
              color: "var(--color-fg)",
            }}
          >
            选手登录
          </h1>
          <p
            className="text-sm"
            style={{ color: "var(--color-fg-mid)" }}
          >
            使用邮箱和密码登录
          </p>
        </div>
        <LoginForm />
      </Panel>
    </div>
  );
}
