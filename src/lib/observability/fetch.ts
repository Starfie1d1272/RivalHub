import "server-only";
import { assertPreviewMutationAllowed, isPreview, PREVIEW_PROJECT_REF } from "@/lib/runtime/preview";

const PROVIDER_INIT = {
  opentelemetry: {
    ignore: true,
    propagateContext: false,
  },
};

export function providerFetch(provider: string): typeof fetch {
  const spanName = `provider.${provider.replace(/[^A-Za-z0-9_.:/-]/g, "_").slice(0, 64)}`;
  return (input: RequestInfo | URL, init?: RequestInit) => {
    if (isPreview()) {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const passwordSignIn = provider === "supabase" && method === "POST"
        && url.origin === `https://${PREVIEW_PROJECT_REF}.supabase.co`
        && url.pathname === "/auth/v1/token" && url.search === "?grant_type=password";
      if (!passwordSignIn) assertPreviewMutationAllowed();
    }
    return fetch(input, {
    ...init,
    ...PROVIDER_INIT,
    opentelemetry: { ...PROVIDER_INIT.opentelemetry, spanName },
    });
  };
}
