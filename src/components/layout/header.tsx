import { db } from "@/db/client";
import { seasons, users } from "@/db/schema";
import { getUserSession } from "@/lib/auth/session";
import { getSteamAvatar } from "@/lib/steam";
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
        columns: { avatarUrl: true, steamName: true, displayName: true, steam64: true },
      })
    : null;

  // 与选手个人页面保持一致：缓存 avatarUrl 优先，null 时从 Steam API 实时拉取
  const avatarUrl = currentUser?.avatarUrl
    ?? (currentUser?.steam64 ? await getSteamAvatar(currentUser.steam64) : null);

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
