import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Django attend les slashs finaux (`/api/v1/health/`) : Next.js ne doit pas les retirer
  // avant que le proxy `/api/[...path]` ne relaie la requête.
  skipTrailingSlashRedirect: true,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
