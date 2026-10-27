import type { Middleware } from "openapi-fetch";

const CSRF_COOKIE = "lest_csrf";
const CSRF_HEADER = "x-lest-csrf";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  const entry = document.cookie.split("; ").find((cookie) => cookie.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

/**
 * Double-submit CSRF (ADR 0001) : recopie le cookie `lest_csrf`, posé par le BFF à la
 * connexion, dans l'en-tête `X-Lest-CSRF` des requêtes d'écriture.
 */
export const csrfMiddleware: Middleware = {
  onRequest({ request }) {
    const token = readCookie(CSRF_COOKIE);
    if (token && !SAFE_METHODS.has(request.method)) request.headers.set(CSRF_HEADER, token);
    return request;
  },
};
