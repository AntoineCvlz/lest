import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { NextConfig } from "next";

// Empreinte du schéma de l'API : la copie hors ligne (ADR 0015) est oubliée quand il change,
// jamais relue avec une forme de données périmée.
const apiSchema = createHash("sha256")
  .update(readFileSync("src/shared/api/schema.d.ts"))
  .digest("hex")
  .slice(0, 16);

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
  env: { LEST_API_SCHEMA: apiSchema },
  // Image Docker de prod : serveur autonome sans node_modules complets.
  output: "standalone",
  // Compile le service worker au build (`@serwist/turbopack`, ADR 0015) : binaire natif, à ne
  // pas embarquer dans le bundle serveur.
  serverExternalPackages: ["esbuild"],
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
