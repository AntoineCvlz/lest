// @vitest-environment node
import { NextRequest } from "next/server";

import { buildUpstreamUrl, GET, POST } from "./route";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  // Indépendant de l'environnement (le conteneur de dev définit API_INTERNAL_URL).
  vi.stubEnv("API_INTERNAL_URL", "http://localhost:8000");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

function lastUpstreamCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.lastCall;
  if (!call) throw new Error("fetch n'a pas été appelé");
  const [input, init = {}] = call;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return { url, init };
}

describe("buildUpstreamUrl", () => {
  it.each([
    ["/api/v1/health/", "?a=1", "http://localhost:8000/api/v1/health/?a=1"],
    ["/api/v1/foods/caf%C3%A9/", "", "http://localhost:8000/api/v1/foods/caf%C3%A9/"],
  ])("relaie %s vers Django", (pathname, search, expected) => {
    expect(buildUpstreamUrl(pathname, search)?.toString()).toBe(expected);
  });

  it.each([
    "/admin/",
    "/api/v2/health/",
    "/api/v1/%2e%2e/%2e%2e/admin/",
    "/api/v1/a%2Fb/",
    "/api/v1/%E0%A4%A/",
  ])("refuse %s", (pathname) => {
    expect(buildUpstreamUrl(pathname, "")).toBeNull();
  });
});

describe("proxy", () => {
  it("transmet uniquement les en-têtes autorisés et conserve le statut et les cookies", async () => {
    const upstreamHeaders = new Headers({ "content-type": "application/json" });
    upstreamHeaders.append("set-cookie", "a=1; HttpOnly");
    upstreamHeaders.append("set-cookie", "b=2; HttpOnly");
    fetchMock.mockResolvedValue(
      new Response('{"ok":true}', { status: 201, headers: upstreamHeaders }),
    );

    const response = await GET(
      new NextRequest("http://localhost:3000/api/v1/health/?x=1", {
        headers: { cookie: "sid=abc", authorization: "Bearer leak", "x-forwarded-host": "evil" },
      }),
    );

    const { url, init } = lastUpstreamCall();
    expect(url).toBe("http://localhost:8000/api/v1/health/?x=1");
    const sent = new Headers(init.headers);
    expect(sent.get("cookie")).toBe("sid=abc");
    expect(sent.has("authorization")).toBe(false);
    expect(sent.has("x-forwarded-host")).toBe(false);
    expect(init.redirect).toBe("manual");

    expect(response.status).toBe(201);
    expect(response.headers.getSetCookie()).toEqual(["a=1; HttpOnly", "b=2; HttpOnly"]);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("relaie le corps des requêtes d'écriture", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await POST(
      new NextRequest("http://localhost:3000/api/v1/weights/", {
        method: "POST",
        body: JSON.stringify({ kg: 82.4 }),
        headers: { "content-type": "application/json" },
      }),
    );

    const { init } = lastUpstreamCall();
    expect(init.method).toBe("POST");
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"kg":82.4}');
  });

  it("répond 404 problem+json hors périmètre sans appeler Django", async () => {
    const response = await GET(new NextRequest("http://localhost:3000/api/v1/%2e%2e/admin/"));

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("répond 502 problem+json si Django est injoignable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const response = await GET(new NextRequest("http://localhost:3000/api/v1/health/"));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ status: 502, title: "Bad Gateway" });
  });
});
