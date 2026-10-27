/**
 * Cookies d'authentification émis par le BFF (ADR 0001). Les jetons ne sont jamais lisibles
 * par le JavaScript : seul `lest_csrf`, qui n'authentifie rien, l'est (double-submit).
 */

export const ACCESS_COOKIE = "lest_at";
export const REFRESH_COOKIE = "lest_rt";
export const SESSION_COOKIE = "lest_st";
export const CSRF_COOKIE = "lest_csrf";

const API_PATH = "/api/";
const AUTH_PATH = "/api/v1/auth/";
const ACCESS_MAX_AGE = 5 * 60;
const REFRESH_MAX_AGE = 14 * 24 * 60 * 60;

interface CookieOptions {
  path: string;
  sameSite: "Lax" | "Strict";
  httpOnly: boolean;
  /** Absent : cookie de session du navigateur. */
  maxAge?: number;
}

function serialize(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${value}`,
    `Path=${options.path}`,
    "Secure",
    `SameSite=${options.sameSite}`,
  ];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.maxAge !== undefined) parts.push(`Max-Age=${String(options.maxAge)}`);
  return parts.join("; ");
}

const OPTIONS: Record<string, CookieOptions> = {
  [ACCESS_COOKIE]: { path: API_PATH, sameSite: "Lax", httpOnly: true, maxAge: ACCESS_MAX_AGE },
  [REFRESH_COOKIE]: { path: API_PATH, sameSite: "Strict", httpOnly: true, maxAge: REFRESH_MAX_AGE },
  [SESSION_COOKIE]: { path: AUTH_PATH, sameSite: "Strict", httpOnly: true },
  [CSRF_COOKIE]: { path: "/", sameSite: "Strict", httpOnly: false, maxAge: REFRESH_MAX_AGE },
};

function options(name: string): CookieOptions {
  const found = OPTIONS[name];
  if (!found) throw new Error(`Cookie inconnu : ${name}`);
  return found;
}

/** `Set-Cookie` qui pose `name` ; `maxAge` remplace la durée par défaut (ex. `expires_in`). */
export function setCookie(name: string, value: string, maxAge?: number): string {
  const base = options(name);
  return serialize(name, value, maxAge === undefined ? base : { ...base, maxAge });
}

/** `Set-Cookie` qui efface `name` (mêmes chemin et attributs, sinon le navigateur l'ignore). */
export function clearCookie(name: string): string {
  return serialize(name, "", { ...options(name), maxAge: 0 });
}
