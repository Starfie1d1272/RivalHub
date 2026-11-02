"use client";

import { createContext, useContext } from "react";
import type { PublicRuntimeConfig } from "@/lib/runtime/public-config";

const Context = createContext<PublicRuntimeConfig | null>(null);
export function PublicRuntimeConfigProvider({ config, children }: { config: PublicRuntimeConfig; children: React.ReactNode }) {
  return <Context.Provider value={config}>{children}</Context.Provider>;
}
export function usePublicRuntimeConfig(): PublicRuntimeConfig {
  const config = useContext(Context);
  if (!config) throw new Error("Public runtime config is unavailable.");
  return config;
}
