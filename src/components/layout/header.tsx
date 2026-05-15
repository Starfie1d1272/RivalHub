import { db } from "@/db/client";
import { seasons, users } from "@/db/schema";
import { getUserSession } from "@/lib/auth/session";
import { resolveAvatarUrl } from "@/lib/steam";
import { HeaderClient } from "./header-client";
import { eq } from "drizzle-orm";

export async function Header() {
  const [allSeasons, session] = await Promise.all([
    db.select().from(seasons),
    getUserSession(),
  ]);

  const publicSeasons = allSeasons.filter(
    (s) => s.status !== "archived" && s.status !== "draft"
  );

  const currentUser = session
    ? await db.query.users.findFirst({
        where: eq(users.id, session.userId),
        columns: { id: true, avatarUrl: true, steamName: true, displayName: true, steam64: true },
      })
    : null;

  const avatarUrl = await resolveAvatarUrl({
    avatarUrl: currentUser?.avatarUrl,
    steam64: currentUser?.steam64,
  });

  // 拉取到新头像 URL 时回写 DB，保持缓存不过期
  if (avatarUrl && avatarUrl !== currentUser?.avatarUrl && currentUser) {
    db.update(users)
      .set({ avatarUrl })
      .where(eq(users.id, currentUser.id))
      .execute()
      .catch(() => {}); // fire-and-forget，不阻塞渲染
  }

  return (
    <HeaderClient
      seasons={publicSeasons}
      session={session}
      avatarUrl={avatarUrl}
      steamName={currentUser?.steamName ?? null}
      displayName={currentUser?.displayName ?? null}
    />
  );
}
