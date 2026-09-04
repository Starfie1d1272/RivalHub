import { cache, Suspense } from "react";
import { eq } from "drizzle-orm";
import { connection } from "next/server";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getCurrentUserAuthorization } from "@/lib/auth/session";

import { HeaderClient } from "./HeaderClient";
import { HeaderNavigationFallback } from "./HeaderNavigation";
import { HeaderPublicNavigation } from "./HeaderPublicNavigation";
import { HeaderViewerClient } from "./HeaderViewerClient";
import type { HeaderSession } from "./Header.types";

const getHeaderViewer = cache(async (): Promise<{
  session: HeaderSession;
  avatarUrl: string | null;
  steamName: string | null;
  displayName: string | null;
} | null> => {
  const authorization = await getCurrentUserAuthorization();
  if (!authorization) return null;

  const user = await db.query.users.findFirst({
    where: eq(users.id, authorization.userId),
    columns: { avatarUrl: true, steamName: true, displayName: true },
  });

  return {
    session: {
      userId: authorization.userId,
      isAdmin: authorization.role === "super_admin" || authorization.seasonIds.length > 0,
      isSuperAdmin: authorization.role === "super_admin",
    },
    avatarUrl: user?.avatarUrl ?? null,
    steamName: user?.steamName ?? null,
    displayName: user?.displayName ?? null,
  };
});

async function HeaderViewer({ variant }: { variant: "desktop" | "mobile" }) {
  // Viewer identity is request-bound. `connection()` makes that boundary
  // explicit inside this Suspense island so public navigation can stay instant.
  await connection();
  const viewer = await getHeaderViewer();
  return (
    <HeaderViewerClient
      variant={variant}
      session={viewer?.session ?? null}
      avatarUrl={viewer?.avatarUrl}
      steamName={viewer?.steamName}
      displayName={viewer?.displayName}
    />
  );
}

function HeaderViewerFallback({ variant }: { variant: "desktop" | "mobile" }) {
  if (variant === "mobile") return null;
  return (
    <div className="hidden sm:block">
      <span
        aria-hidden="true"
        className="inline-flex h-7 min-w-12 items-center justify-center rounded-sm border border-[var(--color-border)] px-2 text-xs font-bold text-[var(--color-fg-mid)]"
        style={{ fontFamily: "var(--font-mono)", letterSpacing: "var(--tracking-label)" }}
      >
        登录
      </span>
    </div>
  );
}

export function Header() {
  return (
    <HeaderClient
      desktopNavigation={
        <Suspense fallback={<HeaderNavigationFallback />}>
          <HeaderPublicNavigation />
        </Suspense>
      }
      mobileNavigation={
        <Suspense fallback={<HeaderNavigationFallback mobile />}>
          <HeaderPublicNavigation mobile />
        </Suspense>
      }
      desktopViewer={
        <Suspense fallback={<HeaderViewerFallback variant="desktop" />}>
          <HeaderViewer variant="desktop" />
        </Suspense>
      }
      mobileViewer={
        <Suspense fallback={<HeaderViewerFallback variant="mobile" />}>
          <HeaderViewer variant="mobile" />
        </Suspense>
      }
    />
  );
}
