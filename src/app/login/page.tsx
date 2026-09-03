import Link from "next/link";
import { LoginForm } from "@/components/auth/LoginForm";
import { Panel } from "@/components/rivalhub";
import { getUserSession } from "@/lib/auth/session";
import { safeLocalRedirect } from "@/lib/auth/redirect";
import { redirect } from "next/navigation";

// Login intentionally waits on request-scoped cookies and query parameters.
// Keep the auth entrypoint blocking without opting the application shell out.
export const instant = false;

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ mode?: string; next?: string | string[] }> }) {
  const params = await searchParams;
  const next = Array.isArray(params.next) ? params.next[0] : params.next;
  const session = await getUserSession();
  if (session) redirect(safeLocalRedirect(next, "/settings") as never);

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
            登录 / 我的 RivalHub
          </h1>
          <p
            className="text-sm"
            style={{ color: "var(--color-fg-mid)" }}
          >
            使用邮箱和密码登录
          </p>
        </div>
        <LoginForm
          initialMode={params.mode === "register" ? "register" : "login"}
          redirectTo={safeLocalRedirect(next)}
        />
        <p className="text-center mt-3">
          <Link href="/forgot-password" className="text-xs text-[var(--color-fg-mid)] hover:text-[var(--color-accent)] transition-colors">
            忘记密码？
          </Link>
        </p>
      </Panel>
    </div>
  );
}
