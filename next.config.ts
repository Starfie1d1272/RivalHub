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

const nextConfig: NextConfig = {
  cacheComponents: true,
  serverExternalPackages: ["pg"],
  typedRoutes: true,
  // The release endpoint is public, but the identity must be frozen into the
  // exact Vercel build because --build-env is not a runtime environment
  // contract. Missing markers remain invalid and make the endpoint fail closed.
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
