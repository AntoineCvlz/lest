import createFetchClient from "openapi-fetch";

import type { paths } from "./auth-schema";
import { csrfMiddleware } from "./csrf";

/**
 * Client des routes de compte (allauth headless, client `app`), typé depuis la spécification
 * d'allauth (`backend/auth-openapi.json`). Il passe par le BFF : les jetons sont retirés des
 * réponses et gardés en cookies `HttpOnly`, jamais visibles ici.
 */
export const authClient = createFetchClient<paths>({
  baseUrl: typeof window === "undefined" ? undefined : window.location.origin,
  fetch: (request) => globalThis.fetch(request),
});
authClient.use(csrfMiddleware);
