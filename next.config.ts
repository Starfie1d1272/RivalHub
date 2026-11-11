import type { NextConfig } from "next";

const localStorageImagePatterns =
  process.env.RIVALHUB_DB_TARGET === "local"
    ? [
        {
          protocol: "http" as const,
          hostname: "127.0.0.1",
          port: "54321",
          pathname: "/storage/v1/object/public/**",
        },
        {
          protocol: "http" as const,
          hostname: "localhost",
          port: "54321",
          pathname: "/storage/v1/object/public/**",
        },
      ]
    : [];

const isCIE2E = ["1", "true"].includes(process.env.CI ?? "")
  && process.env.RIVALHUB_E2E_AUTH_BOOTSTRAP === "1";

const nextConfig: NextConfig = {
  // Local Supabase sends Auth callbacks to 127.0.0.1 even when Next's dev
  // runner starts from localhost. Next only applies this list in development.
  ...(process.env.RIVALHUB_DB_TARGET === "local" ? { allowedDevOrigins: ["127.0.0.1"] } : {}),
  // Keep the framework rendering indicator from intercepting fixture clicks.
  // Next still surfaces compile/runtime errors when this indicator is disabled.
  ...(isCIE2E ? { devIndicators: false as const } : {}),
  ...(process.env.RIVALHUB_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["pg"],
  typedRoutes: true,
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "match\\.starfie1d\\.top" }],
        headers: [{ key: "Strict-Transport-Security", value: "max-age=31536000" }],
      },
      ...["/", "/login", "/my/:path*", "/settings/:path*", "/admin/:path*"].map((source) => ({
        source,
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      })),
    ];
  },
  // The release endpoint is public, but the identity must be frozen into the
  // exact build rather than read from mutable runtime configuration. Missing
  // markers remain invalid and make the endpoint fail closed.
  env: {
    RIVALHUB_RELEASE_TAG: process.env.RIVALHUB_RELEASE_TAG ?? "",
    RIVALHUB_RELEASE_COMMIT: process.env.RIVALHUB_RELEASE_COMMIT ?? "",
  },
  typescript: {
    ignoreBuildErrors: true,
    tsconfigPath: "tsconfig.app.json",
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        port: "",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "avatars.steamstatic.com",
        port: "",
        pathname: "/**",
      },
      ...localStorageImagePatterns,
    ],
  },
};

export default nextConfig;
