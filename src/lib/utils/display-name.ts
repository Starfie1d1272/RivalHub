/**
 * 统一派生用户展示名称：displayName > perfectName > steamName > email 前缀
 */
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
