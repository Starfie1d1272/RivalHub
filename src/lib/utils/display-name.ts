/**
 * 公开展示名称：displayName > perfectName > steamName > fallback
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
