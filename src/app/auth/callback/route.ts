import { NextRequest, NextResponse } from "next/server";
import { createClient, type EmailOtpType } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema/users";
import { createUserSession } from "@/lib/auth/session";
import { normalizeEmail } from "@/lib/utils/email";
import { bootstrapConfiguredOwnerInTx } from "@/lib/auth/owner-bootstrap";
import { safeLocalRedirect } from "@/lib/auth/redirect";

export async function GET(request: NextRequest) {
  const applicationOrigin = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const otpType = searchParams.get("type");
  const flow = callbackFlow(new URL(request.url));
  if (!flow) {
    return NextResponse.redirect(new URL("/login", applicationOrigin));
  }
  const next = safeLocalRedirect(
    searchParams.get("next"),
    flow === "reverify" ? "/settings/education" : "/",
  );

  if (!code && !tokenHash) {
    return NextResponse.redirect(new URL("/login", applicationOrigin));
  }

  if (tokenHash && otpType !== "email" && otpType !== "magiclink") {
    return NextResponse.redirect(new URL("/login", applicationOrigin));
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data, error } = tokenHash
    ? await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: otpType as EmailOtpType,
      })
    : await supabase.auth.exchangeCodeForSession(code!);
  if (error || !data.user?.email) {
    return NextResponse.redirect(new URL("/login", applicationOrigin));
  }

  const authUser = data.user;
  const email = normalizeEmail(authUser.email!);
  const authId = authUser.id;

  const user = await db.transaction(async (tx) => {
    const [upsertedUser] = await tx
      .insert(users)
      .values({ email, authId })
      .onConflictDoUpdate({
        target: users.email,
        set: { authId, updatedAt: new Date() },
      })
      .returning();
    if (!upsertedUser) throw new Error("Auth callback 无法同步用户账号");

    if ((flow === "signup" || flow === "reverify") && authUser.email_confirmed_at) {
      const source = flow === "signup" ? "signup_confirmation" : "existing_account_reverification";
      await tx.update(users).set({ emailVerifiedAt: new Date(), emailVerificationSource: source, updatedAt: new Date() })
        .where(eq(users.id, upsertedUser.id));
    }

    return bootstrapConfiguredOwnerInTx(tx, upsertedUser);
  });

  await createUserSession({
    userId: user.id,
    email: user.email,
    role: user.role,
    adminSeasonIds: user.adminSeasonIds,
    authSource: "user",
  });

  return NextResponse.redirect(new URL(next, applicationOrigin));
}

function callbackFlow(url: URL): "signup" | "reverify" | null {
  const queryFlow = url.searchParams.get("flow");
  if (queryFlow === "signup" || queryFlow === "reverify") return queryFlow;
  const pathFlow = url.pathname.split("/").at(-1);
  return pathFlow === "signup" || pathFlow === "reverify" ? pathFlow : null;
}
