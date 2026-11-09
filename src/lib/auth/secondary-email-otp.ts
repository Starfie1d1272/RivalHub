import { z } from "zod";

const SECONDARY_EMAIL_OTP_TYPES = ["email", "magiclink"] as const;

export type SecondaryEmailOtpType = (typeof SECONDARY_EMAIL_OTP_TYPES)[number];

export const secondaryEmailLinkProofSchema = z.object({
  requestId: z.uuid(),
  stateToken: z.string().min(20).max(200),
  tokenHash: z.string().min(1),
  otpType: z.enum(SECONDARY_EMAIL_OTP_TYPES),
});

/** Only proof types issued by the secondary-email sign-in flow may reach verifyOtp. */
export function isSecondaryEmailOtpType(value: unknown): value is SecondaryEmailOtpType {
  return (
    typeof value === "string" && (SECONDARY_EMAIL_OTP_TYPES as readonly string[]).includes(value)
  );
}
