import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import type { NextRequest } from "next/server";

import { CSRF_COOKIE } from "./cookies";

export const CSRF_HEADER = "x-lest-csrf";
export const CLIENT_IP_HEADER = "x-lest-client-ip";

const DEFAULT_PUBLIC_ORIGIN = "http://localhost:3000";

/** Origines publiques de Lest (`PUBLIC_ORIGIN`, séparées par des virgules). */
function publicOrigins(): Set<string> {
  const configured = process.env.PUBLIC_ORIGIN?.trim();
  const value = configured === undefined || configured === "" ? DEFAULT_PUBLIC_ORIGIN : configured;
  return new Set(value.split(",").map((origin) => origin.trim().replace(/\/+$/, "")));
}

/**
 * Requête émise par une page de Lest : `Origin` dans la liste blanche (et non comparé à `Host`,
 * que le DNS rebinding permet d'aligner), et `Sec-Fetch-Site` à `same-origin` s'il est présent.
 */
export function isSameOrigin(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  return origin !== null && publicOrigins().has(origin);
}

/** Double-submit : l'en-tête `X-Lest-CSRF` doit égaler le cookie `lest_csrf`. */
export function hasValidCsrf(request: NextRequest): boolean {
  const cookie = Buffer.from(request.cookies.get(CSRF_COOKIE)?.value ?? "");
  const header = Buffer.from(request.headers.get(CSRF_HEADER) ?? "");
  // Longueurs comparées en octets : `timingSafeEqual` lève une exception sinon.
  return cookie.length > 0 && cookie.length === header.length && timingSafeEqual(cookie, header);
}

/**
 * IP du navigateur pour la limitation de débit de Django, ou `null`.
 *
 * Lue seulement dans l'en-tête nommé par `TRUSTED_CLIENT_IP_HEADER`, posé par un proxy de bord
 * qui écrase la valeur du client (dernière entrée si c'est une liste). Sans ce réglage
 * (dev, E2E), aucune IP n'est transmise : Django compte alors l'adresse du proxy.
 */
export function clientIp(request: NextRequest): string | null {
  const name = process.env.TRUSTED_CLIENT_IP_HEADER;
  if (!name) return null;
  const last = request.headers.get(name)?.split(",").at(-1)?.trim() ?? "";
  return isIP(last) ? last : null;
}
