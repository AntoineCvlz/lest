import { buildContentSecurityPolicy, buildSecurityHeaders, generateNonce } from "./headers";

const NONCE = "bm9uY2U=";

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split("; ").map((directive) => {
      const [name = "", ...values] = directive.split(" ");
      return [name, values.join(" ")];
    }),
  );
}

describe("generateNonce", () => {
  it("produit 128 bits aléatoires encodés en base64, différents à chaque appel", () => {
    const nonces = new Set(Array.from({ length: 50 }, generateNonce));

    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(atob(nonce)).toHaveLength(16);
  });
});

describe("buildContentSecurityPolicy", () => {
  it("n'autorise en prod aucun script ni style inline sans nonce", () => {
    const csp = directives(buildContentSecurityPolicy({ nonce: NONCE, isDev: false }));

    expect(csp.get("script-src")).toBe(`'self' 'nonce-${NONCE}' 'strict-dynamic'`);
    expect(csp.get("style-src")).toBe(`'self' 'nonce-${NONCE}'`);
    expect(csp.get("object-src")).toBe("'none'");
    expect(csp.get("frame-ancestors")).toBe("'none'");
    expect(csp.has("upgrade-insecure-requests")).toBe(true);
    expect([...csp.values()].join(" ")).not.toMatch(/unsafe/);
  });

  it("assouplit uniquement ce que le mode dev de React exige", () => {
    const csp = directives(buildContentSecurityPolicy({ nonce: NONCE, isDev: true }));

    expect(csp.get("script-src")).toContain("'unsafe-eval'");
    expect(csp.get("style-src")).toBe("'self' 'unsafe-inline'");
    expect(csp.has("upgrade-insecure-requests")).toBe(false);
  });
});

describe("buildSecurityHeaders", () => {
  it("pose HSTS en prod seulement", () => {
    expect(buildSecurityHeaders({ nonce: NONCE, isDev: false })).toHaveProperty(
      "Strict-Transport-Security",
    );
    expect(buildSecurityHeaders({ nonce: NONCE, isDev: true })).not.toHaveProperty(
      "Strict-Transport-Security",
    );
  });

  it("refuse par défaut les permissions sensibles du navigateur", () => {
    const { "Permissions-Policy": permissions } = buildSecurityHeaders({
      nonce: NONCE,
      isDev: false,
    });

    expect(permissions).toContain("camera=()");
    expect(permissions).toContain("geolocation=()");
  });
});
