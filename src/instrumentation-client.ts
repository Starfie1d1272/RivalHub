import { beginTelemetryNavigation } from "@/lib/telemetry/client";

export function onRouterTransitionStart(url: string, navigationType: "push" | "replace" | "traverse") {
  beginTelemetryNavigation(url, navigationType);
}
