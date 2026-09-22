"use client";

import { useEffect } from "react";
import { useOperations, type SeasonScopeData } from "./OperationsContext";

export function SeasonOperationsScope(props: SeasonScopeData) {
  const { setSeasonScope } = useOperations();

  useEffect(() => {
    setSeasonScope(props);
    return () => {
      setSeasonScope(null);
    };
  }, [setSeasonScope, props]);

  return null;
}