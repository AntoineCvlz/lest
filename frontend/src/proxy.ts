import { NextResponse, type NextRequest } from "next/server";

import { buildSecurityHeaders, generateNonce } from "@/shared/security/headers";

/**
 * Pose la CSP à nonce et les en-têtes de sécurité sur chaque page.
 *
 * Next.js lit le nonce dans l'en-tête `Content-Security-Policy` de la requête et l'applique
 * à ses propres scripts ; il faut donc l'écrire sur la requête et sur la réponse.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const headers = buildSecurityHeaders({ nonce, isDev: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"] ?? "");

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages uniquement : ni l'API (JSON relayé), ni les fichiers statiques.
      source: "/((?!api/|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
