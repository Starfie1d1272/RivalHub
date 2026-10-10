/**
 * Canonical human-readable identity formatter.
 *
 * Public surfaces never reveal an email fallback; internal operator surfaces
 * may use only the local part when no public profile identity exists.
 */
export function getPublicDisplayName(user: {
  displayName?: string | null;
  personaName?: string | null;
  perfectName?: string | null;
}): string {
  if (user.displayName) return user.displayName;
  if (user.personaName) return user.personaName;
  if (user.perfectName) return user.perfectName;
  return "未知用户";
}

export function getDisplayName(user: {
  displayName?: string | null;
  personaName?: string | null;
  perfectName?: string | null;
  email?: string | null;
}): string {
  if (user.displayName) return user.displayName;
  if (user.personaName) return user.personaName;
  if (user.perfectName) return user.perfectName;
  if (user.email) return user.email.split("@")[0];
  return "未知用户";
}

/** Match scoreboard presentation only; never use this nickname to resolve identity. */
export function getMatchPlayerDisplayName(name: string, teamName: string | null | undefined): string {
  const team = teamName?.trim();
  if (!team) return name;
  const prefixes = [`[${team}]`, `【${team}】`, team];
  for (const prefix of prefixes) {
    if (name.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) continue;
    const suffix = name.slice(prefix.length);
    if (!/^[\s|｜:：·\-–—]/u.test(suffix)) continue;
    const nickname = suffix.replace(/^[\s|｜:：·\-–—]+/u, "").trim();
    return nickname.length > 0 ? nickname : name;
  }
  return name;
}
