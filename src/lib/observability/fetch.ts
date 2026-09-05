import "server-only";

const PROVIDER_INIT = {
  opentelemetry: {
    ignore: true,
    propagateContext: false,
  },
};

export function providerFetch(provider: string): typeof fetch {
  const spanName = `provider.${provider.replace(/[^A-Za-z0-9_.:/-]/g, "_").slice(0, 64)}`;
  return (input: RequestInfo | URL, init?: RequestInit) => fetch(input, {
    ...init,
    ...PROVIDER_INIT,
    opentelemetry: { ...PROVIDER_INIT.opentelemetry, spanName },
  });
}
