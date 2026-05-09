import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema/users";
import { createUserSession } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user?.email) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const email = data.user.email;
  const authId = data.user.id;

  const [user] = await db
    .insert(users)
    .values({ email, authId })
    .onConflictDoUpdate({
      target: users.email,
      set: { authId, updatedAt: new Date() },
    })
    .returning();

  // 如果系统里还没有 super_admin，第一个登录的用户自动升级
  let finalRole = user.role;
  if (user.role === "user") {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.role, "super_admin"));
    if (count === 0) {
      await db
        .update(users)
        .set({ role: "super_admin" })
        .where(eq(users.id, user.id));
      finalRole = "super_admin";
    }
  }

  await createUserSession({
    userId: user.id,
    email: user.email,
    role: finalRole,
    adminSeasonIds: user.adminSeasonIds,
    authSource: "user",
  });

  return NextResponse.redirect(new URL(next, request.url));
}

function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}
