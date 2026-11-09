"use client";

import { createContext, useContext, type CSSProperties } from "react";

/** Body portals inherit the nearest visual scope through the React tree. */
const PortalThemeContext = createContext<CSSProperties | undefined>(undefined);
export const PortalThemeProvider = PortalThemeContext.Provider;

export function usePortalTheme(style?: CSSProperties): CSSProperties | undefined {
  const scoped = useContext(PortalThemeContext);
  return scoped && style ? { ...scoped, ...style } : (scoped ?? style);
}
