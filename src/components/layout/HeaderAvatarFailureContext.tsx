"use client";

import React, { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface HeaderAvatarFailureContextValue {
  failedAvatarUrl: string | null;
  markAvatarFailed: (avatarUrl: string) => void;
}

const HeaderAvatarFailureContext = createContext<HeaderAvatarFailureContextValue>({
  failedAvatarUrl: null,
  markAvatarFailed: () => undefined,
});

export function HeaderAvatarFailureProvider({ children }: { children: ReactNode }) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const value = useMemo(() => ({ failedAvatarUrl, markAvatarFailed: setFailedAvatarUrl }), [failedAvatarUrl]);
  return <HeaderAvatarFailureContext.Provider value={value}>{children}</HeaderAvatarFailureContext.Provider>;
}

export function useHeaderAvatarFailure(avatarUrl?: string | null) {
  const { failedAvatarUrl, markAvatarFailed } = useContext(HeaderAvatarFailureContext);
  return {
    avatarFailed: Boolean(avatarUrl && failedAvatarUrl === avatarUrl),
    markAvatarFailed: () => {
      if (avatarUrl) markAvatarFailed(avatarUrl);
    },
  };
}
