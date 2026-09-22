"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { PublicAnnouncement } from "@/lib/announcements/presentation";
import type { PublicSeasonInfo } from "@/lib/season-public-info/presentation";

export type SeasonScopeData = {
  season: { id: string; slug: string };
  seasonInfo: PublicSeasonInfo | null;
  latestAnnouncement: PublicAnnouncement | null;
  attentionAnnouncement: PublicAnnouncement | null;
};

export type OperationsContextValue = {
  seasonScope: SeasonScopeData | null;
  setSeasonScope: (scope: SeasonScopeData | null) => void;
};

const OperationsContext = createContext<OperationsContextValue | null>(null);

export function OperationsProvider({ children }: { children: ReactNode }) {
  const [seasonScope, setSeasonScope] = useState<SeasonScopeData | null>(null);

  return (
    <OperationsContext.Provider value={{ seasonScope, setSeasonScope }}>
      {children}
    </OperationsContext.Provider>
  );
}

export function useOperations(): OperationsContextValue {
  const ctx = useContext(OperationsContext);
  if (!ctx) {
    throw new Error("useOperations must be used within an OperationsProvider");
  }
  return ctx;
}
