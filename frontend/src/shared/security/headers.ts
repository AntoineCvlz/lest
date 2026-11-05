/**
 * En-têtes de sécurité des pages (OWASP ASVS V14) : CSP stricte à nonce + en-têtes associés.
 *
 * En dev uniquement, React exige `'unsafe-eval'` (piles d'erreurs) et le rechargement à chaud
 * injecte des styles inline. En prod, aucun `unsafe-*`.
 */

export interface SecurityHeadersOptions {
  nonce: string;
  isDev: boolean;
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function buildContentSecurityPolicy({ nonce, isDev }: SecurityHeadersOptions): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`],
    "img-src": ["'self'", "blob:", "data:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'"],
    // App installable (ADR 0015) : le manifest vient de notre origine seulement.
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  // Hors dev : `localhost` est servi en HTTP, la mise à niveau casserait les ressources.
  if (!isDev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

export function buildSecurityHeaders(options: SecurityHeadersOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": buildContentSecurityPolicy(options),
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    // Tout est refusé, sauf la caméra pour notre seule origine (scan d'un code-barres, ADR 0009) :
    // jamais pour un cadre ou une origine tierce.
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  };
  if (!options.isDev) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload";
  }
  return headers;
}
