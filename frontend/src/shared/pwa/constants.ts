/**
 * Noms partagés entre l'app et le service worker (ADR 0015). Module sans dépendance : le
 * service worker l'embarque tel quel.
 */

/** Adresse du service worker, servie par `app/serwist/[path]/route.ts`. */
export const SERVICE_WORKER_URL = "/serwist/sw.js";

/** Page affichée hors ligne pour une page jamais ouverte sur cet appareil. */
export const OFFLINE_PAGE = "/hors-ligne";

/** Pages déjà ouvertes (coque HTML, sans donnée de l'API), vidé à la déconnexion. */
export const PAGES_CACHE = "lest-pages";

/** Images d'exercices, publiques (ADR 0005). */
export const EXERCISE_IMAGES_CACHE = "lest-exercise-images";
export const EXERCISE_IMAGES_PATH = "/api/v1/exercise-images/";
