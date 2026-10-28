import { NextResponse, type NextRequest } from "next/server";

import { signInRedirect } from "@/features/auth/private-routes";
import { buildSecurityHeaders, generateNonce } from "@/shared/security/headers";

/**
 * Pose la CSP à nonce et les en-têtes de sécurité sur chaque page, et renvoie vers la connexion
 * une page privée ouverte sans session (confort d'interface : l'API reste seule à protéger).
 *
 * Next.js lit le nonce dans l'en-tête `Content-Security-Policy` de la requête et l'applique
 * à ses propres scripts ; il faut donc l'écrire sur la requête et sur la réponse.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const headers = buildSecurityHeaders({ nonce, isDev: process.env.NODE_ENV === "development" });

  const signIn = signInRedirect(request);
  if (signIn) {
    const redirect = NextResponse.redirect(signIn);
    for (const [name, value] of Object.entries(headers)) redirect.headers.set(name, value);
    return redirect;
  }

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
