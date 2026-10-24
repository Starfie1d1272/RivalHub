import "server-only";

/** Public ticket origin is configured by the operator, independent of proxy request headers. */
export function configuredTelemetryOrigin(): string | null {
  try {
    const url = new URL(process.env.PRODUCT_TELEMETRY_ORIGIN ?? "");
    return url.protocol === "https:" && !url.username && !url.password && url.href === `${url.origin}/` ? url.origin : null;
  } catch { return null; }
}
