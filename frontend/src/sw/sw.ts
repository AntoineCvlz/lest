/**
 * Service worker de Lest (ADR 0015) : la coque de l'app, jamais les données.
 *
 * - fichiers du build et de `public/` : précachés, versionnés par le build ;
 * - pages : réseau d'abord (3 s), copie de la dernière version sinon, page « hors ligne »
 *   pour une page jamais ouverte ; seules les réponses 200 finales sont gardées (pas une
 *   page de connexion obtenue par redirection) ;
 * - images d'exercices (publiques) : cache d'abord ;
 * - tout le reste de `/api/` n'est pas intercepté : aucune réponse de l'API n'est copiée ;
 * - notification de fin de repos touchée : retour à l'app (ADR 0015).
 */
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
  type PrecacheEntry,
  type SerwistGlobalConfig,
  type SerwistPlugin,
} from "serwist";

import {
  EXERCISE_IMAGES_CACHE,
  EXERCISE_IMAGES_PATH,
  OFFLINE_PAGE,
  PAGES_CACHE,
} from "../shared/pwa/constants";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Liste de précache injectée au build par `@serwist/turbopack`.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** Ne garde qu'une page servie telle quelle (200, sans redirection). */
const finalPagesOnly: SerwistPlugin = {
  cacheWillUpdate: ({ response }) =>
    Promise.resolve(response.status === 200 && !response.redirected ? response : null),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cleanupOutdatedCaches: true },
  // Nouvelle version active au prochain lancement de l'app, jamais en pleine séance.
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  disableDevLogs: true,
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith(EXERCISE_IMAGES_PATH),
      handler: new CacheFirst({
        cacheName: EXERCISE_IMAGES_CACHE,
        plugins: [new ExpirationPlugin({ maxEntries: 300 })],
      }),
    },
    {
      matcher: ({ request, url, sameOrigin }) =>
        sameOrigin && request.mode === "navigate" && !url.pathname.startsWith("/api/"),
      handler: new NetworkFirst({
        cacheName: PAGES_CACHE,
        networkTimeoutSeconds: 3,
        plugins: [finalPagesOnly, new ExpirationPlugin({ maxEntries: 50 })],
      }),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: OFFLINE_PAGE,
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

// Notification de fin de repos touchée : retour à l'app ouverte, sinon à la séance.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const [open] = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (open) await open.focus();
      else await self.clients.openWindow("/seance");
    })(),
  );
});

serwist.addEventListeners();
