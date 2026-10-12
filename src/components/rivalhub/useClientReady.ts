"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

// Keep SSR and the hydration render non-interactive until handlers are attached.
export function useClientReady() {
  return useSyncExternalStore(subscribe, clientReady, serverReady);
}
