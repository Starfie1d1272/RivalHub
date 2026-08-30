/**
 * Canonical human-readable identity formatter.
 *
 * Public surfaces never reveal an email fallback; internal operator surfaces
 * may use only the local part when no public profile identity exists.
 */
export function getPublicDisplayName(user: {
  displayName?: string | null;
  perfectName?: string | null;
  steamName?: string | null;
}): string {
  if (user.displayName) return user.displayName;
  if (user.perfectName) return user.perfectName;
  if (user.steamName) return user.steamName;
  return "未知用户";
}

export function getDisplayName(user: {
  displayName?: string | null;
  perfectName?: string | null;
  steamName?: string | null;
  email?: string | null;
}): string {
  if (user.displayName) return user.displayName;
  if (user.perfectName) return user.perfectName;
  if (user.steamName) return user.steamName;
  if (user.email) return user.email.split("@")[0];
  return "未知用户";
}
