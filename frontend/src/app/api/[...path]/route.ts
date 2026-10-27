import { randomBytes } from "node:crypto";

import type { NextRequest } from "next/server";

import {
  ACCESS_COOKIE,
  clearCookie,
  CSRF_COOKIE,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  setCookie,
} from "@/shared/bff/cookies";
import { CLIENT_IP_HEADER, clientIp, hasValidCsrf, isSameOrigin } from "@/shared/bff/guards";
import {
  extractTokens,
  type IssuedTokens,
  parseRefreshResponse,
  refreshOnce,
  type RefreshResult,
  type TokenPair,
} from "@/shared/bff/tokens";

/**
 * BFF même origine vers l'API Django (ADR 0001).
 *
 * Le navigateur ne parle qu'à Next.js et ne voit jamais un jeton : ceux d'allauth sont retirés
 * des réponses et gardés en cookies `HttpOnly`, puis ajoutés vers Django (`Authorization`,
 * `X-Session-Token`). Un accès expiré est renouvelé côté serveur et la requête rejouée une fois.
 * Seules les routes `/api/v1/` sont relayées, avec une liste blanche d'en-têtes.
 */

const DEFAULT_API_ORIGIN = "http://localhost:8000";
const ALLOWED_PREFIX = "/api/v1/";
const AUTH_PREFIX = "/api/v1/auth/";
// Renouvellement réservé au BFF : le navigateur n'a pas le refresh token à envoyer.
const REFRESH_PATH = "/api/v1/auth/app/v1/tokens/refresh";
const REFRESH_PATH_SUFFIX = "/tokens/refresh";
const SESSION_PATH = "/api/v1/auth/app/v1/auth/session";

// Ni `cookie` (les cookies sont ceux de Next.js), ni `authorization` : posés par le BFF.
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "user-agent",
] as const;

// En-têtes propres à la connexion amont, invalides une fois le corps relayé par Next.js ;
// `set-cookie` : seul Next.js émet des cookies vers le navigateur.
const DROPPED_RESPONSE_HEADERS = [
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "set-cookie",
  "transfer-encoding",
] as const;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

/** URL amont, ou `null` si le chemin sort du périmètre `/api/v1/`. */
export function buildUpstreamUrl(pathname: string, search: string): URL | null {
  if (!pathname.startsWith(ALLOWED_PREFIX)) return null;
  const segments = pathname.split("/").map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return "..";
    }
  });
  if (segments.some((segment) => segment === ".." || segment === "." || segment.includes("/"))) {
    return null;
  }
  const url = new URL(pathname + search, apiOrigin());
  return url.pathname.startsWith(ALLOWED_PREFIX) ? url : null;
}

function apiOrigin(): string {
  return process.env.API_INTERNAL_URL ?? DEFAULT_API_ORIGIN;
}

function problem(status: number, title: string, instance: string): Response {
  return new Response(JSON.stringify({ type: "about:blank", title, status, instance }), {
    status,
    headers: { "content-type": "application/problem+json", "cache-control": "no-store" },
  });
}

/** Refresh impossible pour une raison passagère (Django injoignable, 5xx, 429). */
class RefreshUnavailable extends Error {}

async function refreshUpstream(refreshToken: string): Promise<RefreshResult> {
  const response = await fetch(new URL(REFRESH_PATH, apiOrigin()), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
    redirect: "manual",
    cache: "no-store",
  });
  // 400/401 : refresh invalide, révoqué ou expiré. Le reste (5xx, 429…) est passager.
  if (response.status === 400 || response.status === 401) return { kind: "rejected" };
  if (!response.ok) return { kind: "unavailable" };
  const pair = parseRefreshResponse(await response.json());
  return pair ? { kind: "ok", pair } : { kind: "unavailable" };
}

/** Chemin tel que Django le route : segments décodés, sans slash final. */
function routedPath(pathname: string): string {
  return decodeURIComponent(pathname).replace(/\/+$/, "");
}

interface Credentials {
  access?: string;
  refresh?: string;
  session?: string;
}

async function proxy(request: NextRequest): Promise<Response> {
  const { pathname, search } = request.nextUrl;
  const upstreamUrl = buildUpstreamUrl(pathname, search);
  // Décisions prises sur le chemin décodé : `%61uth` ou `%72efresh` atteignent les mêmes vues.
  const routed = upstreamUrl ? routedPath(pathname) : "";
  if (!upstreamUrl || routed.endsWith(REFRESH_PATH_SUFFIX)) {
    return problem(404, "Not Found", pathname);
  }
  if (!SAFE_METHODS.has(request.method) && !isSameOrigin(request)) {
    return problem(403, "Forbidden", pathname);
  }
  const isLogout = request.method === "DELETE" && routed === SESSION_PATH;
  if (isLogout && !hasValidCsrf(request)) return problem(403, "Forbidden", pathname);

  const isAuthRoute = `${routed}/`.startsWith(AUTH_PREFIX);
  const body = METHODS_WITHOUT_BODY.has(request.method) ? undefined : await request.arrayBuffer();
  const credentials: Credentials = {
    access: request.cookies.get(ACCESS_COOKIE)?.value,
    refresh: request.cookies.get(REFRESH_COOKIE)?.value,
    session: request.cookies.get(SESSION_COOKIE)?.value,
  };

  const send = (): Promise<Response> => {
    const headers = new Headers();
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    if (credentials.access) headers.set("authorization", `Bearer ${credentials.access}`);
    if (isAuthRoute && credentials.session) headers.set("x-session-token", credentials.session);
    const ip = clientIp(request);
    if (ip) headers.set(CLIENT_IP_HEADER, ip);
    return fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
    });
  };

  // Accès expiré (le cookie vit autant que le jeton) : renouveler avant d'appeler Django.
  let rotated: TokenPair | null = null;
  let signedOut = false;
  let attempted = false;
  // `false` si rien n'a été renouvelé ; lève `RefreshUnavailable` sur panne passagère.
  const renew = async (): Promise<boolean> => {
    if (!credentials.refresh || attempted) return false;
    attempted = true;
    const result = await refreshOnce(credentials.refresh, refreshUpstream);
    if (result.kind === "unavailable") throw new RefreshUnavailable();
    if (result.kind === "rejected") {
      signedOut = true;
      credentials.access = undefined;
      return false;
    }
    rotated = result.pair;
    credentials.access = result.pair.access;
    return true;
  };

  let upstream: Response;
  try {
    if (!credentials.access) await renew();
    const sentAccess = credentials.access;
    upstream = await send();
    // Accès refusé : un seul renouvellement, puis un seul rejeu.
    if (upstream.status === 401 && sentAccess && !isLogout && (await renew())) {
      upstream = await send();
    }
  } catch (error) {
    // Panne passagère du refresh : cookies conservés, le client peut réessayer.
    if (error instanceof RefreshUnavailable) return problem(503, "Service Unavailable", pathname);
    return problem(502, "Bad Gateway", pathname);
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of DROPPED_RESPONSE_HEADERS) responseHeaders.delete(name);
  // Réponses personnelles (jetons en cookies, données de santé) : aucun cache, ni partagé ni local.
  responseHeaders.set("cache-control", "no-store");

  let responseBody: BodyInit | null = upstream.body;
  let issued: IssuedTokens = {};
  const hasBody = request.method !== "HEAD" && ![204, 304].includes(upstream.status);
  if (
    isAuthRoute &&
    hasBody &&
    responseHeaders.get("content-type")?.startsWith("application/json")
  ) {
    let json: unknown;
    try {
      json = await upstream.json();
    } catch {
      // Jamais relayer un corps d'authentification qu'on n'a pas pu assainir.
      return problem(502, "Bad Gateway", pathname);
    }
    issued = extractTokens(json);
    responseBody = JSON.stringify(json);
  }

  for (const cookie of cookiesFor({ request, isLogout, issued, rotated, signedOut })) {
    responseHeaders.append("set-cookie", cookie);
  }
  return new Response(responseBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

function cookiesFor({
  request,
  isLogout,
  issued,
  rotated,
  signedOut,
}: {
  request: NextRequest;
  isLogout: boolean;
  issued: IssuedTokens;
  rotated: TokenPair | null;
  signedOut: boolean;
}): string[] {
  if (isLogout) {
    return [ACCESS_COOKIE, REFRESH_COOKIE, SESSION_COOKIE, CSRF_COOKIE].map(clearCookie);
  }
  const cookies: string[] = [];
  if (issued.access && issued.refresh) {
    // Nouvelle connexion : nouveau jeton CSRF (pas de fixation d'un jeton antérieur). Le jeton
    // de parcours n'a plus d'usage (le JWT porte la session) : on ne le garde pas.
    cookies.push(
      clearCookie(SESSION_COOKIE),
      setCookie(ACCESS_COOKIE, issued.access, issued.expiresIn),
      setCookie(REFRESH_COOKIE, issued.refresh),
      setCookie(CSRF_COOKIE, randomBytes(32).toString("base64url")),
    );
  } else if (rotated) {
    cookies.push(
      setCookie(ACCESS_COOKIE, rotated.access),
      setCookie(REFRESH_COOKIE, rotated.refresh),
    );
    if (!request.cookies.has(CSRF_COOKIE)) {
      cookies.push(setCookie(CSRF_COOKIE, randomBytes(32).toString("base64url")));
    }
  } else if (signedOut) {
    cookies.push(
      clearCookie(ACCESS_COOKIE),
      clearCookie(REFRESH_COOKIE),
      clearCookie(SESSION_COOKIE),
    );
  } else if (issued.session) {
    // Parcours en attente (inscription, vérification d'e-mail) : jeton gardé pour la suite.
    cookies.push(setCookie(SESSION_COOKIE, issued.session));
  }
  return cookies;
}

export {
  proxy as DELETE,
  proxy as GET,
  proxy as HEAD,
  proxy as OPTIONS,
  proxy as PATCH,
  proxy as POST,
  proxy as PUT,
};
