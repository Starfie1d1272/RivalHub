import { getDisplayName } from "@/lib/identity/display-name";

export function getFeedbackUserLabel(input: {
  userId: string | null;
  displayName?: string | null;
  perfectName?: string | null;
  steamName?: string | null;
  email?: string | null;
}): string | null {
  return input.userId ? getDisplayName(input) : null;
}
