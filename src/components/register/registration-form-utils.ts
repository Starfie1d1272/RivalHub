import type { ReactNode } from "react";
import type { FieldPath } from "react-hook-form";
import { POSITION_LABELS, type RegistrationInput } from "@/lib/validators/registration";
import { PLAYABLE_MAP_LEVELS } from "@/lib/maps";
import type { MapPreferenceLevel } from "@/types/season";

export interface RegistrationFieldFeedback {
  renderError: (name: FieldPath<RegistrationInput>) => ReactNode;
  errorAttributes: (name: FieldPath<RegistrationInput>) => {
    "aria-invalid"?: true;
    "aria-describedby"?: string;
  };
}

export function isPositionFull(
  pos: string,
  positionCounts: Record<string, number>,
  maxPerPosition: number,
): boolean {
  return (positionCounts[pos] ?? 0) >= maxPerPosition;
}

export function buildPositionLabel(
  pos: string,
  positionCounts: Record<string, number>,
  maxPerPosition: number,
): string {
  const position = POSITION_LABELS[pos as keyof typeof POSITION_LABELS];
  const count = positionCounts[pos] ?? 0;
  const label = position?.full ?? pos;
  const full = count >= maxPerPosition;
  return `${label}  ${full ? "已满" : `${count}/${maxPerPosition}`}`;
}

export function countMapPreferenceLevels(
  mapPreferences: { map: string; level: MapPreferenceLevel | null }[],
): { playableCount: number; strongCount: number } {
  return {
    playableCount: mapPreferences.filter(
      (preference) => preference.level !== null && PLAYABLE_MAP_LEVELS.has(preference.level),
    ).length,
    strongCount: mapPreferences.filter((preference) => preference.level === "strong").length,
  };
}
