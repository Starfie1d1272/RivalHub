"use client";
import { useRoutePolling } from "@/components/use-visible-polling";
/** Low-frequency canonical context only; live frames arrive solely via private Broadcast. */
export function MatchContextRefresh({ enabled }: { enabled: boolean }) {
  useRoutePolling(enabled ? 15000 : null);
  return null;
}
