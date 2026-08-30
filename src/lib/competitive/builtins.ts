/**
 * 2.0 ships exactly these competitive-profile domains. The database catalog
 * remains the runtime owner; new platform identities require an explicit
 * product/migration change instead of operator-created ad-hoc domains.
 */
export const BUILT_IN_COMPETITIVE_PLATFORM_KEYS = ["perfect_world", "fivee"] as const;

export type BuiltInCompetitivePlatformKey = (typeof BUILT_IN_COMPETITIVE_PLATFORM_KEYS)[number];

export function isBuiltInCompetitivePlatformKey(value: string): value is BuiltInCompetitivePlatformKey {
  return (BUILT_IN_COMPETITIVE_PLATFORM_KEYS as readonly string[]).includes(value);
}
