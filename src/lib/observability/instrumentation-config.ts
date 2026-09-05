import type { FetchInstrumentationConfig } from "@vercel/otel";
import type { BetterStackConfig } from "@/lib/observability/config";

export function getFetchInstrumentationConfig(betterStack?: BetterStackConfig): FetchInstrumentationConfig {
  const internalOrigins = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
    process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : undefined,
  ].map(normalizeOrigin).filter((value): value is string => value !== undefined);
  const providerOrigins = [
    betterStack?.baseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    "https://api.steampowered.com",
    "https://api.siliconflow.cn",
    "https://challenges.cloudflare.com",
    process.env.SILICONFLOW_API_URL,
  ].map(normalizeOrigin).filter((value): value is string => value !== undefined);

  return {
    ignoreUrls: providerOrigins,
    dontPropagateContextUrls: providerOrigins,
    propagateContextUrls: internalOrigins,
  };
}

function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return undefined;
  }
}
