import "server-only";

import { createHash } from "node:crypto";
import type { Season } from "@/db/schema";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";

/** Bind the preview to the saved row, including changes in the same timestamp tick. */
export function getSeasonConfirmationVersion(season: Season): string {
  const canonical = JSON.stringify(season, (_key, value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    );
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function assertSeasonConfirmationVersion(season: Season, expectedVersion: string): void {
  if (getSeasonConfirmationVersion(season) !== expectedVersion) {
    throw new AppError(
      ErrorCode.SEASON_CONFIGURATION_CHANGED,
      ERROR_MESSAGES.SEASON_CONFIGURATION_CHANGED,
    );
  }
}
