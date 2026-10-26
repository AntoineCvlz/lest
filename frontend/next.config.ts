import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Django attend les slashs finaux (`/api/v1/health/`) : Next.js ne doit pas les retirer
  // avant que le proxy `/api/[...path]` ne relaie la requête.
  skipTrailingSlashRedirect: true,
  // `cacheComponents` et `partialPrefetching` (défauts de Next 16.4) reposent sur des coquilles
  // pré-rendues dont les scripts ne peuvent pas porter le nonce de la CSP : désactivés.
  // Toutes les pages de Lest sont personnelles, donc rendues à la requête de toute façon.
  cacheComponents: false,
  partialPrefetching: false,
  poweredByHeader: false,
  // Image Docker de prod : serveur autonome sans node_modules complets.
  output: "standalone",
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
