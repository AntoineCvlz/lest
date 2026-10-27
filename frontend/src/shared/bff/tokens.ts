/**
 * Jetons d'allauth (client `app`) : retirés des réponses avant le navigateur, et renouvelés
 * côté serveur avec un verrou pour que des requêtes simultanées ne consomment pas deux fois
 * le même refresh (la rotation invalide l'ancien).
 */

export interface IssuedTokens {
  access?: string;
  refresh?: string;
  session?: string;
  /** Durée de vie de l'accès en secondes, si allauth l'indique. */
  expiresIn?: number;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Retire en place tout jeton de la réponse et renvoie ceux de `meta` (connexion, parcours en
 * attente). `data.*_token` (réponse de refresh) est retiré aussi, par défense en profondeur.
 */
export function extractTokens(body: unknown): IssuedTokens {
  if (!isObject(body)) return {};
  if (isObject(body.data)) {
    delete body.data.access_token;
    delete body.data.refresh_token;
  }
  if (!isObject(body.meta)) return {};
  const meta = body.meta;
  const tokens: IssuedTokens = {
    access: nonEmpty(meta.access_token),
    refresh: nonEmpty(meta.refresh_token),
    session: nonEmpty(meta.session_token),
    expiresIn:
      typeof meta.expires_in === "number" && meta.expires_in > 0 ? meta.expires_in : undefined,
  };
  delete meta.access_token;
  delete meta.refresh_token;
  delete meta.session_token;
  return tokens;
}

export interface TokenPair {
  access: string;
  refresh: string;
}

/** `rejected` : refresh refusé (déconnexion) ; `unavailable` : panne passagère (réessayer). */
export type RefreshResult =
  { kind: "ok"; pair: TokenPair } | { kind: "rejected" } | { kind: "unavailable" };
export type RefreshFn = (refreshToken: string) => Promise<RefreshResult>;

// Paire conservée brièvement : un onglet qui envoie encore l'ancien refresh juste après la
// rotation la reçoit au lieu d'un échec. Fenêtre courte : elle suspend la détection de
// réutilisation d'allauth pour ce jeton.
const GRACE_MS = 2_000;
const MAX_ENTRIES = 1_000;
const MAX_TOKEN_LENGTH = 2_048;
const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;
const inflight = new Map<string, Promise<RefreshResult>>();

/** Forme d'un JWT : un cookie arbitraire ne déclenche pas d'appel à Django. */
export function looksLikeJwt(token: string): boolean {
  return token.length <= MAX_TOKEN_LENGTH && JWT_SHAPE.test(token);
}

/** Un seul appel à `refresh` par refresh token, partagé par toutes les requêtes simultanées. */
export function refreshOnce(refreshToken: string, refresh: RefreshFn): Promise<RefreshResult> {
  if (!looksLikeJwt(refreshToken)) return Promise.resolve({ kind: "rejected" });
  const pending = inflight.get(refreshToken);
  if (pending) return pending;
  const promise = refresh(refreshToken)
    .catch((): RefreshResult => ({ kind: "unavailable" }))
    .then((result) => {
      // Un échec n'est pas mis en cache : la requête suivante réessaie.
      if (result.kind === "ok") {
        setTimeout(() => inflight.delete(refreshToken), GRACE_MS).unref();
      } else {
        inflight.delete(refreshToken);
      }
      return result;
    });
  if (inflight.size < MAX_ENTRIES) inflight.set(refreshToken, promise);
  return promise;
}

/** Paire de jetons d'une réponse `tokens/refresh` d'allauth, ou `null` si invalide. */
export function parseRefreshResponse(body: unknown): TokenPair | null {
  if (!isObject(body) || !isObject(body.data)) return null;
  const { access_token: access, refresh_token: refresh } = body.data;
  return typeof access === "string" && typeof refresh === "string" ? { access, refresh } : null;
}
