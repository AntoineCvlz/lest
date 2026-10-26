import createFetchClient from "openapi-fetch";
import createQueryClient from "openapi-react-query";

import type { components, paths } from "./schema";

export type Schemas = components["schemas"];

/**
 * Client du navigateur. Il appelle le proxy Next.js sur la même origine (`/api/...`),
 * jamais Django directement : les cookies d'authentification restent first-party.
 */
export const fetchClient = createFetchClient<paths>({
  baseUrl: typeof window === "undefined" ? undefined : window.location.origin,
  // Résolu à chaque appel (et non capturé au chargement) : un `fetch` instrumenté
  // après coup — MSW en test, télémétrie — est bien pris en compte.
  fetch: (request) => globalThis.fetch(request),
});

/** Hooks TanStack Query typés depuis l'OpenAPI : `$api.useQuery("get", "/api/v1/...")`. */
export const $api = createQueryClient(fetchClient);
