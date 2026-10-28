// @vitest-environment node
import { NextRequest } from "next/server";

import { safeNext, signInRedirect } from "./private-routes";

function pageRequest(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe("signInRedirect", () => {
  it.each(["/profil", "/profil/", "/bienvenue"])(
    "renvoie %s vers la connexion sans indice de session",
    (path) => {
      const target = signInRedirect(pageRequest(path));

      expect(target?.pathname).toBe("/connexion");
      expect(target?.searchParams.get("suivant")).toBe(path.replace(/\/$/, ""));
    },
  );

  it("laisse passer une page privée quand une session est ouverte", () => {
    expect(signInRedirect(pageRequest("/profil", "lest_csrf=jeton"))).toBeNull();
  });

  it.each(["/", "/connexion", "/inscription", "/profil-public", "/profilx"])(
    "ne touche pas à une page publique : %s",
    (path) => {
      expect(signInRedirect(pageRequest(path))).toBeNull();
    },
  );
});

describe("safeNext", () => {
  it.each(["/profil", "/bienvenue"])("accepte la page privée %s", (path) => {
    expect(safeNext(path)).toBe(path);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\evil.example",
    "/connexion",
    "/profil?x=1",
    "",
    undefined,
    ["/profil", "/bienvenue"],
  ])("refuse %j et revient à l'accueil", (value) => {
    expect(safeNext(value)).toBe("/");
  });
});
