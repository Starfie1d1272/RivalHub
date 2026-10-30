"use client";

import { useSyncExternalStore } from "react";
import { isDeploymentUpdateRequired } from "@/lib/auth/login-update-draft";

let required = false;
const listeners = new Set<() => void>();

export function deploymentUpdateRequired() { return required; }
export function subscribeDeploymentUpdate(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function reportDeploymentUpdate(error: unknown) {
  if (!isDeploymentUpdateRequired(error)) return false;
  if (!required) {
    required = true;
    listeners.forEach(listener => listener());
  }
  return true;
}
export function useDeploymentUpdate() {
  return useSyncExternalStore(subscribeDeploymentUpdate, deploymentUpdateRequired, () => false);
}
