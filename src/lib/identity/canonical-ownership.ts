import { normalizeEmail } from "../utils/email";

/** The runtime resolver and consistency audit must use these same credential keys. */
export const CANONICAL_AUTH_PROVIDER = "supabase_auth";
export const CANONICAL_EMAIL_KIND = "email";

interface IdentityLike {
  kind: string;
  provider: string;
  providerSubject: string;
  normalizedValue: string | null;
}

function matchesCanonicalAuthIdentity(
  identity: IdentityLike,
  authId: string,
): boolean {
  return identity.provider === CANONICAL_AUTH_PROVIDER && identity.providerSubject === authId;
}

export function matchesCanonicalEmailIdentity(
  identity: IdentityLike,
  email: string,
): boolean {
  return identity.kind === CANONICAL_EMAIL_KIND && identity.normalizedValue === normalizeEmail(email);
}

export function matchesCanonicalIdentity(
  identity: IdentityLike,
  authId: string,
  email: string | null,
): boolean {
  return matchesCanonicalAuthIdentity(identity, authId) ||
    (email !== null && matchesCanonicalEmailIdentity(identity, email));
}
