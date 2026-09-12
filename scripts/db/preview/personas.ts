import { createHash } from "node:crypto";

export const PREVIEW_PERSONAS = ["player", "invited", "captain", "season-admin", "super-admin"] as const;
export type PreviewPersona = (typeof PREVIEW_PERSONAS)[number];

/** Public, disposable fixture credential; never source it from protected environment config. */
export const PREVIEW_PERSONA_PASSWORD = "rivalhub-preview-persona-resettable";

export type PersonaCandidates = {
  currentSeasonId: string | null;
  playerUserId: string | null;
  invitedUserId: string | null;
  captainUserId: string | null;
  seasonAdminUserId: string | null;
  superAdminUserId: string | null;
};

export type PersonaBinding = {
  persona: PreviewPersona;
  userId: string;
  authId: string;
  email: string;
};

export function syntheticUserId(persona: PreviewPersona): string {
  const hex = createHash("sha256").update(`rivalhub-preview-${persona}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function deterministicUserId(snapshotUsers: readonly Record<string, unknown>[], candidates: PersonaCandidates | undefined, persona: PreviewPersona, used: Set<string>): string | null {
  const candidate = candidates && (persona === "player" ? candidates.playerUserId
    : persona === "invited" ? candidates.invitedUserId
      : persona === "captain" ? candidates.captainUserId
        : persona === "season-admin" ? candidates.seasonAdminUserId
          : candidates.superAdminUserId);
  if (candidate && !used.has(candidate) && snapshotUsers.some((user) => String(user.id) === candidate && user.status === "active")) return candidate;
  const fallback = [...snapshotUsers]
    .filter((user) => user.status === "active" && typeof user.id === "string" && !used.has(String(user.id)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
  return fallback ? String(fallback.id) : null;
}
