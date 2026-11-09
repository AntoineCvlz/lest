"use client";

import { useEffect } from "react";

import { PAGES_CACHE, SERVICE_WORKER_URL } from "./constants";

/**
 * Enregistre le service worker (ADR 0015), en prod seulement : en dev, il garderait des
 * copies périmées face au rechargement à chaud.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    // `updateViaCache: "none"` : chaque lancement vérifie la version auprès du serveur.
    navigator.serviceWorker
      .register(SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // Sans service worker, l'app marche en ligne comme avant : rien à montrer.
      });
  }, []);
  return null;
}

/**
 * Oublie les pages gardées pour le hors-ligne (déconnexion, changement de compte) : l'accueil
 * diffère selon la session. Les pages ne contiennent aucune donnée de l'API.
 */
export async function clearCachedPages(): Promise<void> {
  if (typeof caches === "undefined") return;
  await caches.delete(PAGES_CACHE);
}
