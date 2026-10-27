import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";

import { authClient } from "./auth-client";
import { fetchClient } from "./client";

function captureHeaders(): () => Headers | undefined {
  let headers: Headers | undefined;
  server.use(
    http.all("*/api/v1/*", ({ request }) => {
      headers = request.headers;
      return HttpResponse.json({ status: 200 });
    }),
  );
  return () => headers;
}

afterEach(() => {
  document.cookie = "lest_csrf=; Max-Age=0; Path=/";
});

describe("en-tête CSRF double-submit", () => {
  it("recopie le cookie lest_csrf sur les requêtes d'écriture", async () => {
    document.cookie = "lest_csrf=jeton-csrf; Path=/";
    const headers = captureHeaders();

    await authClient.DELETE("/api/v1/auth/app/v1/auth/session");

    expect(headers()?.get("x-lest-csrf")).toBe("jeton-csrf");
  });

  it("ne l'envoie pas sur les lectures", async () => {
    document.cookie = "lest_csrf=jeton-csrf; Path=/";
    const headers = captureHeaders();

    await fetchClient.GET("/api/v1/me/");

    expect(headers()?.has("x-lest-csrf")).toBe(false);
  });

  it("n'envoie rien sans cookie", async () => {
    const headers = captureHeaders();

    await authClient.DELETE("/api/v1/auth/app/v1/auth/session");

    expect(headers()?.has("x-lest-csrf")).toBe(false);
  });
});
