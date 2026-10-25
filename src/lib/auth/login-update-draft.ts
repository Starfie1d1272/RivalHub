export { unstable_isUnrecognizedActionError as isDeploymentUpdateRequired } from "next/navigation";

const KEY = "rivalhub:login-update-email";
const TTL_MS = 15 * 60_000;

/** Only the email is eligible; passwords and provider/session tickets never enter storage. */
export function preserveLoginUpdateEmail(email: string): boolean {
  try {
    if (!email) { sessionStorage.removeItem(KEY); return true; }
    if (email.length > 254) return false;
    sessionStorage.setItem(KEY, JSON.stringify({ email, expiresAt: Date.now() + TTL_MS }));
    return true;
  } catch { return false; }
}

/** Consume once in the same tab after the user explicitly chose to update. */
export function takeLoginUpdateEmail(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const draft = value as { email?: unknown; expiresAt?: unknown };
    return typeof draft.email === "string" && draft.email.length <= 254
      && typeof draft.expiresAt === "number" && draft.expiresAt > Date.now()
      && draft.expiresAt <= Date.now() + TTL_MS ? draft.email : null;
  } catch { return null; }
}
