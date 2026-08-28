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
  serverExternalPackages: ["pg"],
  typedRoutes: true,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
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
