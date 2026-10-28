// @vitest-environment node
import { NextRequest } from "next/server";

import { buildUpstreamUrl, DELETE, GET, POST } from "./route";

const fetchMock = vi.fn<typeof fetch>();
const ORIGIN = "http://localhost:3000";
const REFRESH_URL = "http://localhost:8000/api/v1/auth/app/v1/tokens/refresh";
const LOGIN_PATH = "/api/v1/auth/app/v1/auth/login";
const SESSION_PATH = "/api/v1/auth/app/v1/auth/session";
const CSRF = "jeton-csrf-de-test-0123456789abcdef";

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  // Indépendant de l'environnement (le conteneur de dev définit API_INTERNAL_URL).
  vi.stubEnv("API_INTERNAL_URL", "http://localhost:8000");
  vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "");
  vi.stubEnv("PUBLIC_ORIGIN", ORIGIN);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

// Chaque test a ses propres jetons : le verrou de refresh garde ses résultats quelques secondes.
let seq = 0;
function unique(name: string): string {
  seq += 1;
  return `${name}-${String(seq)}.charge.signature`;
}

interface Call {
  url: string;
  init: RequestInit;
  headers: Headers;
}

function urlOf(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function calls(): Call[] {
  return fetchMock.mock.calls.map(([input, init = {}]) => ({
    url: urlOf(input),
    init,
    headers: new Headers(init.headers),
  }));
}

function lastCall(): Call {
  const all = calls();
  const last = all.at(-1);
  if (!last) throw new Error("fetch n'a pas été appelé");
  return last;
}

function request(
  path: string,
  {
    method = "GET",
    cookies = {},
    headers = {},
    body,
  }: {
    method?: string;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(method);
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    body,
    headers: {
      ...(unsafe ? { origin: ORIGIN } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setCookies(response: Response): Record<string, string> {
  return Object.fromEntries(
    response.headers.getSetCookie().map((cookie) => {
      const name = cookie.slice(0, cookie.indexOf("="));
      return [name, cookie];
    }),
  );
}

function refreshed(access: string, refresh: string): Response {
  return json({ status: 200, data: { access_token: access, refresh_token: refresh } });
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

describe("relais", () => {
  it("transmet uniquement les en-têtes autorisés, jamais les cookies ni ceux de Django", async () => {
    const upstreamHeaders = new Headers({ "content-type": "application/json" });
    upstreamHeaders.append("set-cookie", "sessionid=django; HttpOnly");
    fetchMock.mockResolvedValue(
      new Response('{"ok":true}', { status: 201, headers: upstreamHeaders }),
    );

    const response = await GET(
      request("/api/v1/health/?x=1", {
        cookies: { sessionid: "admin" },
        headers: {
          authorization: "Bearer leak",
          "x-forwarded-host": "evil",
          "x-session-token": "leak",
          // IP choisie par le client : Django ne doit jamais la recevoir (limitation de débit).
          "x-forwarded-for": "198.51.100.1",
          "x-lest-client-ip": "198.51.100.2",
        },
      }),
    );

    const { url, init, headers } = lastCall();
    expect(url).toBe("http://localhost:8000/api/v1/health/?x=1");
    for (const name of [
      "cookie",
      "authorization",
      "x-forwarded-host",
      "x-session-token",
      "x-forwarded-for",
      "x-lest-client-ip",
    ]) {
      expect(headers.has(name)).toBe(false);
    }
    expect(init.redirect).toBe("manual");
    expect(response.status).toBe(201);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("relaie le corps des requêtes d'écriture", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await POST(
      request("/api/v1/weights/", {
        method: "POST",
        body: JSON.stringify({ kg: 82.4 }),
        headers: { "content-type": "application/json" },
      }),
    );

    const { init } = lastCall();
    expect(init.method).toBe("POST");
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"kg":82.4}');
  });

  it("répond 404 problem+json hors périmètre sans appeler Django", async () => {
    const response = await GET(request("/api/v1/%2e%2e/admin/"));

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuse l'appel direct du renouvellement de jetons, réservé au BFF", async () => {
    const response = await POST(
      request("/api/v1/auth/app/v1/tokens/refresh", { method: "POST", body: "{}" }),
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("répond 502 problem+json si Django est injoignable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const response = await GET(request("/api/v1/health/"));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ status: 502, title: "Bad Gateway" });
  });
});

describe("contrôle de l'origine", () => {
  it.each([
    ["absente", {}],
    ["d'un autre site", { origin: "https://evil.example" }],
    ["malformée", { origin: "null" }],
  ])("refuse une écriture dont l'origine est %s", async (_label, headers) => {
    const response = await POST(
      new NextRequest(`${ORIGIN}/api/v1/weights/`, { method: "POST", body: "{}", headers }),
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("n'exige pas d'origine pour une lecture", async () => {
    fetchMock.mockResolvedValue(json({}));

    const response = await GET(new NextRequest(`${ORIGIN}/api/v1/me/`));

    expect(response.status).toBe(200);
  });
});

describe("connexion", () => {
  it("retire les jetons de la réponse et les pose en cookies HttpOnly", async () => {
    fetchMock.mockResolvedValue(
      json({
        status: 200,
        data: { user: { email: "a@example.com" } },
        meta: {
          is_authenticated: true,
          access_token: "at-1",
          refresh_token: "rt-1",
          session_token: "st-1",
          expires_in: 300,
        },
      }),
    );

    const response = await POST(
      request(LOGIN_PATH, { method: "POST", body: '{"email":"a@example.com"}' }),
    );

    const body = await response.text();
    for (const secret of ["at-1", "rt-1", "st-1"]) expect(body).not.toContain(secret);
    expect(JSON.parse(body)).toEqual({
      status: 200,
      data: { user: { email: "a@example.com" } },
      meta: { is_authenticated: true, expires_in: 300 },
    });

    const cookies = setCookies(response);
    expect(cookies.lest_at).toBe(
      "lest_at=at-1; Path=/api/; Secure; SameSite=Lax; HttpOnly; Max-Age=300",
    );
    expect(cookies.lest_rt).toBe(
      "lest_rt=rt-1; Path=/api/; Secure; SameSite=Strict; HttpOnly; Max-Age=1209600",
    );
    expect(cookies.lest_st).toBe(
      "lest_st=; Path=/api/v1/auth/; Secure; SameSite=Strict; HttpOnly; Max-Age=0",
    );
    expect(cookies.lest_csrf).toMatch(
      /^lest_csrf=[\w-]{43}; Path=\/; Secure; SameSite=Strict; Max-Age=/,
    );
    expect(cookies.lest_csrf).not.toContain("HttpOnly");
  });

  it("garde le jeton de parcours d'une inscription en attente et l'envoie à allauth", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          status: 401,
          data: { flows: [] },
          meta: { is_authenticated: false, session_token: "st-2" },
        },
        401,
      ),
    );
    const signup = await POST(
      request("/api/v1/auth/app/v1/auth/signup", { method: "POST", body: "{}" }),
    );
    expect(await signup.text()).not.toContain("st-2");
    expect(setCookies(signup).lest_at).toBeUndefined();

    fetchMock.mockResolvedValueOnce(json({ status: 200 }));
    await POST(
      request("/api/v1/auth/app/v1/auth/email/verify", {
        method: "POST",
        body: "{}",
        cookies: { lest_st: "st-2" },
      }),
    );

    expect(lastCall().headers.get("x-session-token")).toBe("st-2");
  });

  it("n'envoie le jeton de parcours qu'à allauth", async () => {
    fetchMock.mockResolvedValue(json({}));

    await GET(request("/api/v1/me/", { cookies: { lest_st: "st-3", lest_at: "at-3" } }));

    expect(lastCall().headers.has("x-session-token")).toBe(false);
  });
});

describe("appels authentifiés", () => {
  it("ajoute le jeton d'accès du cookie en Authorization", async () => {
    fetchMock.mockResolvedValue(json({ id: "u" }));

    await GET(request("/api/v1/me/", { cookies: { lest_at: "at-4" } }));

    expect(lastCall().headers.get("authorization")).toBe("Bearer at-4");
  });

  it("renouvelle avant l'appel si le cookie d'accès a expiré", async () => {
    const rt = unique("rt");
    fetchMock.mockImplementation((input) =>
      Promise.resolve(urlOf(input) === REFRESH_URL ? refreshed("at-new", "rt-new") : json({})),
    );

    const response = await GET(
      request("/api/v1/me/", { cookies: { lest_rt: rt, lest_csrf: CSRF } }),
    );

    const [refresh, me] = calls();
    expect(refresh?.url).toBe(REFRESH_URL);
    expect(JSON.parse(refresh?.init.body as string)).toEqual({ refresh_token: rt });
    expect(me?.headers.get("authorization")).toBe("Bearer at-new");
    const cookies = setCookies(response);
    expect(cookies.lest_at).toMatch(/^lest_at=at-new;/);
    expect(cookies.lest_rt).toMatch(/^lest_rt=rt-new;/);
    // Même jeton CSRF, durée prolongée comme celle du refresh (session glissante).
    expect(cookies.lest_csrf).toBe(
      `lest_csrf=${CSRF}; Path=/; Secure; SameSite=Strict; Max-Age=1209600`,
    );
  });

  it("sur 401, renouvelle une seule fois et rejoue une seule fois", async () => {
    const rt = unique("rt");
    fetchMock.mockImplementation((input) =>
      Promise.resolve(
        urlOf(input) === REFRESH_URL ? refreshed("at-new", "rt-new") : json({ status: 401 }, 401),
      ),
    );

    const response = await GET(
      request("/api/v1/me/", { cookies: { lest_at: "at-old", lest_rt: rt } }),
    );

    expect(calls().map((call) => call.headers.get("authorization") ?? call.url)).toEqual([
      "Bearer at-old",
      REFRESH_URL,
      "Bearer at-new",
    ]);
    expect(response.status).toBe(401);
  });

  it("efface les cookies si le refresh est refusé", async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(json({ status: 401 }, urlOf(input) === REFRESH_URL ? 400 : 401)),
    );

    const response = await GET(
      request("/api/v1/me/", { cookies: { lest_at: "at-old", lest_rt: unique("rt") } }),
    );

    expect(response.status).toBe(401);
    const cookies = setCookies(response);
    expect(cookies.lest_at).toContain("Max-Age=0");
    expect(cookies.lest_rt).toContain("Max-Age=0");
  });

  it("partage un seul refresh entre requêtes simultanées", async () => {
    const rt = unique("rt");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async (input) => {
      if (urlOf(input) !== REFRESH_URL) return json({});
      await gate;
      return refreshed("at-shared", "rt-shared");
    });

    const pending = [1, 2, 3].map(() => GET(request("/api/v1/me/", { cookies: { lest_rt: rt } })));
    release();
    const responses = await Promise.all(pending);

    expect(calls().filter((call) => call.url === REFRESH_URL)).toHaveLength(1);
    for (const response of responses) {
      expect(setCookies(response).lest_rt).toMatch(/^lest_rt=rt-shared;/);
    }
  });

  it("ne renouvelle pas un 401 sans jeton d'accès envoyé (parcours allauth normal)", async () => {
    fetchMock.mockResolvedValue(json({ status: 401, meta: { is_authenticated: false } }, 401));

    await GET(request(SESSION_PATH));

    expect(calls()).toHaveLength(1);
  });
});

describe("déconnexion", () => {
  it("exige le jeton CSRF double-submit", async () => {
    const response = await DELETE(
      request(SESSION_PATH, {
        method: "DELETE",
        cookies: { lest_at: "at-5", lest_csrf: "abc" },
        headers: { "x-lest-csrf": "abd" },
      }),
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("révoque la session côté Django et efface tous les cookies", async () => {
    fetchMock.mockResolvedValue(json({ status: 401, meta: { is_authenticated: false } }, 401));

    const response = await DELETE(
      request(SESSION_PATH, {
        method: "DELETE",
        cookies: { lest_at: "at-6", lest_rt: unique("rt"), lest_st: "st-6", lest_csrf: "abc" },
        headers: { "x-lest-csrf": "abc" },
      }),
    );

    expect(lastCall().init.method).toBe("DELETE");
    expect(lastCall().headers.get("authorization")).toBe("Bearer at-6");
    const cookies = setCookies(response);
    for (const name of ["lest_at", "lest_rt", "lest_st", "lest_csrf"]) {
      expect(cookies[name]).toContain("Max-Age=0");
    }
  });
});

describe("IP du navigateur", () => {
  it("transmet la dernière IP de l'en-tête du proxy de bord, si configuré", async () => {
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-forwarded-for");
    fetchMock.mockResolvedValue(json({}));

    await GET(
      request("/api/v1/health/", { headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.7" } }),
    );

    expect(lastCall().headers.get("x-lest-client-ip")).toBe("203.0.113.7");
  });

  it("ignore une valeur qui n'est pas une IP", async () => {
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-forwarded-for");
    fetchMock.mockResolvedValue(json({}));

    await GET(request("/api/v1/health/", { headers: { "x-forwarded-for": "pas-une-ip" } }));

    expect(lastCall().headers.has("x-lest-client-ip")).toBe(false);
  });
});

describe("durcissement", () => {
  it("interdit toute mise en cache, y compris des erreurs du BFF", async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(urlOf(input) === REFRESH_URL ? refreshed("at-c", unique("rt")) : json({})),
    );

    const rotated = await GET(request("/api/v1/me/", { cookies: { lest_rt: unique("rt") } }));
    const notFound = await GET(request("/api/v1/%2e%2e/admin/"));

    expect(rotated.headers.getSetCookie()).not.toEqual([]);
    expect(rotated.headers.get("cache-control")).toBe("no-store");
    expect(notFound.headers.get("cache-control")).toBe("no-store");
  });

  it("répond 503 sans déconnecter si le refresh échoue passagèrement, puis réessaie", async () => {
    const rt = unique("rt");
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const first = await GET(request("/api/v1/me/", { cookies: { lest_rt: rt } }));

    expect(first.status).toBe(503);
    expect(first.headers.getSetCookie()).toEqual([]);

    fetchMock.mockImplementation((input) =>
      Promise.resolve(urlOf(input) === REFRESH_URL ? refreshed("at-r", unique("rt")) : json({})),
    );
    const second = await GET(request("/api/v1/me/", { cookies: { lest_rt: rt } }));

    expect(second.status).toBe(200);
    expect(calls().filter((call) => call.url === REFRESH_URL)).toHaveLength(2);
  });

  it.each([500, 429])("traite un refresh en %i comme une panne passagère", async (status) => {
    fetchMock.mockResolvedValue(json({}, status));

    const response = await GET(request("/api/v1/me/", { cookies: { lest_rt: unique("rt") } }));

    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("efface aussi le jeton de parcours quand le refresh est refusé", async () => {
    fetchMock.mockResolvedValue(json({ status: 400 }, 400));

    const response = await GET(
      request("/api/v1/me/", { cookies: { lest_rt: unique("rt"), lest_st: "st-9" } }),
    );

    expect(setCookies(response).lest_st).toContain("Max-Age=0");
  });

  it("n'appelle pas Django pour un refresh qui n'a pas la forme d'un JWT", async () => {
    fetchMock.mockResolvedValue(json({ status: 401 }, 401));

    await GET(request("/api/v1/me/", { cookies: { lest_rt: "x" } }));

    expect(calls().map((call) => call.url)).toEqual(["http://localhost:8000/api/v1/me/"]);
  });

  it.each([
    "/api/v1/auth/app/v1/tokens/%72efresh",
    "/api/v1/auth/app/v1/tokens/refresh/",
    "/api/v1/%61uth/app/v1/tokens/refresh",
  ])("refuse le renouvellement direct déguisé : %s", async (path) => {
    const response = await POST(request(path, { method: "POST", body: "{}" }));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("assainit une réponse d'allauth atteinte par un chemin encodé", async () => {
    fetchMock.mockResolvedValue(json({ meta: { access_token: "at-x", refresh_token: "rt-x" } }));

    const response = await POST(
      request("/api/v1/%61uth/app/v1/auth/login", { method: "POST", body: "{}" }),
    );

    const body = await response.text();
    expect(body).not.toContain("at-x");
    expect(body).not.toContain("rt-x");
  });

  it("retire aussi les jetons de `data`", async () => {
    fetchMock.mockResolvedValue(json({ data: { access_token: "at-d", refresh_token: "rt-d" } }));

    const response = await GET(request(SESSION_PATH));

    expect(await response.json()).toEqual({ data: {} });
  });

  it("répond 502 sans relayer un corps d'authentification illisible", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"meta":{"access_token":"at-t"', {
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await GET(request(SESSION_PATH));

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("at-t");
  });

  it("refuse un jeton CSRF de même longueur mais d'autres octets, sans planter", async () => {
    const response = await DELETE(
      request(SESSION_PATH, {
        method: "DELETE",
        cookies: { lest_csrf: "a".repeat(43) },
        headers: { "x-lest-csrf": "é".repeat(43) },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("refuse une origine absente de la liste blanche, même si elle égale l'hôte", async () => {
    const response = await POST(
      new NextRequest("http://evil.example/api/v1/weights/", {
        method: "POST",
        body: "{}",
        headers: { origin: "http://evil.example", host: "evil.example" },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("refuse une écriture que le navigateur déclare inter-sites", async () => {
    const response = await POST(
      request("/api/v1/weights/", {
        method: "POST",
        body: "{}",
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );

    expect(response.status).toBe(403);
  });
});

describe("réinitialisation du mot de passe", () => {
  it.each([
    "/api/v1/auth/app/v1/auth/password/reset",
    "/api/v1/%61uth/app/v1/auth/password/reset/",
  ])("refuse la consultation d’un code par GET : %s", async (path) => {
    const response = await GET(request(path, { headers: { "x-password-reset-key": "BCDF-GHJK" } }));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("relaie l’envoi du code et du nouveau mot de passe (POST)", async () => {
    fetchMock.mockResolvedValue(json({ status: 401 }, 401));

    await POST(request("/api/v1/auth/app/v1/auth/password/reset", { method: "POST", body: "{}" }));

    expect(lastCall().url).toBe("http://localhost:8000/api/v1/auth/app/v1/auth/password/reset");
  });
});

describe("indice de session lest_csrf", () => {
  it("est effacé quand le refresh est refusé (session révoquée)", async () => {
    fetchMock.mockResolvedValue(json({ status: 400 }, 400));

    const response = await GET(
      request("/api/v1/me/", { cookies: { lest_rt: unique("rt"), lest_csrf: CSRF } }),
    );

    expect(setCookies(response).lest_csrf).toContain("Max-Age=0");
  });

  it("est régénéré à la rotation si sa valeur n'a pas la forme attendue", async () => {
    fetchMock.mockImplementation((input) =>
      Promise.resolve(urlOf(input) === REFRESH_URL ? refreshed("at-n", unique("rt")) : json({})),
    );

    const response = await GET(
      request("/api/v1/me/", { cookies: { lest_rt: unique("rt"), lest_csrf: "x;Domain=evil" } }),
    );

    expect(setCookies(response).lest_csrf).toMatch(/^lest_csrf=[\w-]{43};/);
  });
});
