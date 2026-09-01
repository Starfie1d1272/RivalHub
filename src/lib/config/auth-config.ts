export const MIN_PASSWORD_LENGTH = 6;

const DEFAULT_EMAIL_RESEND_COOLDOWN_SECONDS = 60;

/**
 * Client-side repeat-click guard. Deployments must set this to the same value
 * as Supabase Auth's email `max_frequency` so the UI never promises a faster
 * resend cadence than the provider accepts.
 */
export const EMAIL_RESEND_COOLDOWN_SECONDS = parseEmailResendCooldownSeconds(
  process.env.NEXT_PUBLIC_AUTH_EMAIL_RESEND_COOLDOWN_SECONDS,
);

export const PASSWORD_POLICY_MESSAGE =
  `密码至少 ${MIN_PASSWORD_LENGTH} 位，并包含大写字母、小写字母、数字和特殊字符`;

const PASSWORD_SPECIAL_CHARACTERS = "!@#$%^&*()_+-=[]{};':\"|<>?,./`~";

export function isPasswordPolicySatisfied(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /[0-9]/.test(password)
    && [...password].some((character) => PASSWORD_SPECIAL_CHARACTERS.includes(character));
}

function parseEmailResendCooldownSeconds(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_EMAIL_RESEND_COOLDOWN_SECONDS;
}
