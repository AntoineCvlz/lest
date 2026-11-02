/** Préfixe de toutes les requêtes de séance : données privées, retirées à l'expiration de la
 * session (`PRIVATE_QUERY_KEYS`). Module léger, sans le poids des écrans qui les lisent. */
export const WORKOUTS_KEY = ["workouts"] as const;

/** Programmes du compte (séances types et cibles) : privés, retirés comme les séances. */
export const PROGRAMS_KEY = ["programs"] as const;
