import type { NextRequest } from "next/server";

/**
 * Proxy même origine vers l'API Django.
 *
 * Le navigateur ne parle qu'à Next.js : les cookies (JWT httpOnly en Phase 1) restent
 * first-party et Django n'est jamais exposé. Seules les routes `/api/v1/` sont relayées,
 * avec une liste blanche d'en-têtes dans les deux sens.
 */

const API_ORIGIN = process.env.API_INTERNAL_URL ?? "http://localhost:8000";
const ALLOWED_PREFIX = "/api/v1/";

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "cookie",
  "user-agent",
  "x-csrftoken",
] as const;

// En-têtes propres à la connexion amont, invalides une fois le corps relayé par Next.js.
const DROPPED_RESPONSE_HEADERS = [
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "transfer-encoding",
] as const;

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
  const url = new URL(pathname + search, API_ORIGIN);
  return url.pathname.startsWith(ALLOWED_PREFIX) ? url : null;
}

function problem(status: number, title: string, instance: string): Response {
  return new Response(JSON.stringify({ type: "about:blank", title, status, instance }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

async function proxy(request: NextRequest): Promise<Response> {
  const { pathname, search } = request.nextUrl;
  const upstreamUrl = buildUpstreamUrl(pathname, search);
  if (!upstreamUrl) return problem(404, "Not Found", pathname);

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: METHODS_WITHOUT_BODY.has(request.method) ? undefined : await request.arrayBuffer(),
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return problem(502, "Bad Gateway", pathname);
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const name of DROPPED_RESPONSE_HEADERS) responseHeaders.delete(name);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
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
