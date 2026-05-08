import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { db } from "@/db/client";
import { users } from "@/db/schema/users";
import { createUserSession } from "@/lib/auth/session";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

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

  // Upsert user 记录（按 email 查找，更新 authId；不存在则创建）
  const [user] = await db
    .insert(users)
    .values({ email, authId })
    .onConflictDoUpdate({
      target: users.email,
      set: { authId, updatedAt: new Date() },
    })
    .returning();

  await createUserSession({
    userId: user.id,
    email: user.email,
    role: user.role,
    adminSeasonIds: user.adminSeasonIds,
  });

  return NextResponse.redirect(new URL(next, request.url));
}
