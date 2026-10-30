import type { NextRequest } from "next/server";

import { CSRF_COOKIE } from "@/shared/bff/cookies";

/**
 * Pages réservées aux comptes connectés. Le garde ne protège rien : l'API exige le JWT et
 * refuse tout le reste. Il évite seulement d'afficher une page vide avant de dire « connectez-
 * vous », et ramène sur la page demandée une fois connecté.
 */
export const PRIVATE_ROUTES = ["/profil", "/bienvenue", "/exercices"] as const;
export type PrivateRoute = (typeof PRIVATE_ROUTES)[number];

/** Paramètre de `/connexion` : page où revenir après la connexion. */
export const NEXT_PARAM = "suivant";

function privateRoute(pathname: string): PrivateRoute | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PRIVATE_ROUTES.find((route) => route === path) ?? null;
}

/**
 * URL de connexion pour une page privée ouverte sans session, ou `null`.
 *
 * Les cookies de jetons (`Path=/api/`) ne partent pas avec les pages : l'indice de session est
 * `lest_csrf` (`Path=/`), posé à la connexion et effacé à la déconnexion.
 */
export function signInRedirect(request: NextRequest): URL | null {
  const route = privateRoute(request.nextUrl.pathname);
  if (!route || request.cookies.has(CSRF_COOKIE)) return null;
  const target = new URL("/connexion", request.url);
  target.searchParams.set(NEXT_PARAM, route);
  return target;
}

/** Destination après connexion : une page privée connue, sinon l'accueil (jamais une URL libre). */
export function safeNext(value: unknown): PrivateRoute | "/" {
  return typeof value === "string" ? (privateRoute(value) ?? "/") : "/";
}
