import { createSerwistRoute } from "@serwist/turbopack";

import { OFFLINE_PAGE } from "@/shared/pwa/constants";

// Route statique : le service worker est compilé une fois, au build (ADR 0015). La révision
// de la page hors ligne change donc à chaque build.
const revision = crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute(
  {
    swSrc: "src/sw/sw.ts",
    additionalPrecacheEntries: [{ url: OFFLINE_PAGE, revision }],
    // esbuild natif (déjà dans l'arbre de dépendances) plutôt que sa version WebAssembly.
    useNativeEsbuild: true,
  },
);
