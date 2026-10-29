import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import {
  CONFIRM_AGAIN,
  FACTORS_UNAVAILABLE,
  PASSKEY_ADDED,
  PASSKEY_REFUSED,
  PASSKEY_REMOVED,
  SecurityPanel,
} from "./security-panel";
import type * as Webauthn from "./webauthn";
import {
  createPasskey,
  getPasskey,
  PASSKEY_CANCELLED,
  PasskeyError,
  passkeysSupported,
} from "./webauthn";

// Les cérémonies du navigateur sont testées dans `webauthn.test.ts` (et en E2E avec
// l'authentificateur virtuel de Chromium) ; ici, seul leur résultat compte.
vi.mock("./webauthn", async (importOriginal) => ({
  ...(await importOriginal<typeof Webauthn>()),
  passkeysSupported: vi.fn(() => true),
  createPasskey: vi.fn(),
  getPasskey: vi.fn(),
}));

const BASE = "*/api/v1/auth/app/v1";
const CREATION = { publicKey: { challenge: "Y3JlYXRl" } };
const REQUEST = { publicKey: { challenge: "Z2V0" } };
const ATTESTATION = { id: "nouvelle", response: { attestationObject: "AA" } };
const ASSERTION = { id: "existante", response: { signature: "AA" } };
const OCTOBER_29 = 1_793_260_800; // 29 octobre 2026, 12 h UTC

function authenticators(list: object[]) {
  return http.get(`${BASE}/account/authenticators`, () =>
    HttpResponse.json({ status: 200, data: list }),
  );
}

const phone = { type: "webauthn", id: 7, name: "Téléphone", created_at: OCTOBER_29 };

const creationOptions = (onQuery?: (url: URL) => void) =>
  http.get(`${BASE}/account/authenticators/webauthn`, ({ request }) => {
    onQuery?.(new URL(request.url));
    return HttpResponse.json({ status: 200, data: { creation_options: CREATION } });
  });

const requestOptions = http.get(`${BASE}/auth/webauthn/reauthenticate`, () =>
  HttpResponse.json({ status: 200, data: { request_options: REQUEST } }),
);

beforeEach(() => {
  vi.mocked(createPasskey).mockResolvedValue(ATTESTATION);
  vi.mocked(getPasskey).mockResolvedValue(ASSERTION);
  vi.mocked(passkeysSupported).mockReturnValue(true);
});

describe("Passkeys", () => {
  it("ajoute une première passkey avec le mot de passe, puis montre les codes de secours", async () => {
    let query: URL | undefined;
    let added: unknown;
    server.use(
      authenticators([]),
      http.post(`${BASE}/auth/reauthenticate`, () =>
        HttpResponse.json({ status: 200, meta: { is_authenticated: true } }),
      ),
      creationOptions((url) => (query = url)),
      http.post(`${BASE}/account/authenticators/webauthn`, async ({ request }) => {
        added = await request.json();
        return HttpResponse.json({
          status: 200,
          data: phone,
          meta: { recovery_codes_generated: true },
        });
      }),
      http.get(`${BASE}/account/authenticators/recovery-codes`, () =>
        HttpResponse.json({ status: 200, data: { unused_codes: ["11112222"] } }),
      ),
    );
    renderWithQuery(<SecurityPanel />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Ajouter une passkey" }));
    await user.type(screen.getByLabelText("Mot de passe, pour confirmer"), "mot-de-passe");
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    const name = await screen.findByRole("textbox", { name: "Nom de la passkey" });
    await user.clear(name);
    await user.type(name, "Téléphone");
    await user.click(screen.getByRole("button", { name: "Créer la passkey" }));

    expect(await screen.findByRole("list", { name: "Codes de secours" })).toHaveTextContent(
      "11112222",
    );
    expect(screen.getByRole("status")).toHaveTextContent(PASSKEY_ADDED);
    // Passkey utilisable sans mot de passe : clé résidente et vérification exigées.
    expect(query?.searchParams.has("passwordless")).toBe(true);
    expect(createPasskey).toHaveBeenCalledWith(CREATION);
    expect(added).toEqual({ name: "Téléphone", credential: ATTESTATION });
  });

  it("exige un second facteur pour ajouter une passkey quand l'application est active", async () => {
    let confirmedWith: unknown;
    server.use(
      authenticators([{ type: "totp" }, { type: "recovery_codes" }]),
      http.post(`${BASE}/auth/2fa/reauthenticate`, async ({ request }) => {
        confirmedWith = await request.json();
        return HttpResponse.json({ status: 200, meta: { is_authenticated: true } });
      }),
      creationOptions(),
    );
    renderWithQuery(<SecurityPanel />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Ajouter une passkey" }));

    expect(screen.queryByLabelText("Mot de passe, pour confirmer")).not.toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", {
        name: "Code de l’application ou code de secours, pour confirmer",
      }),
      "123 456",
    );
    await user.click(screen.getByRole("button", { name: "Continuer" }));

    expect(await screen.findByRole("textbox", { name: "Nom de la passkey" })).toBeInTheDocument();
    expect(confirmedWith).toEqual({ code: "123456" });
  });

  it("exige un second facteur pour activer l'application quand une passkey existe", async () => {
    server.use(authenticators([phone, { type: "recovery_codes" }]), requestOptions);
    renderWithQuery(<SecurityPanel />);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Activer la double authentification" }),
    );

    expect(screen.queryByLabelText("Mot de passe, pour confirmer")).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Code de secours, pour confirmer" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Confirmer avec une passkey" }),
    ).toBeInTheDocument();
  });

  it("retire une passkey après confirmation par passkey", async () => {
    let confirmedWith: unknown;
    let removed: unknown;
    server.use(
      authenticators([phone, { type: "recovery_codes" }]),
      requestOptions,
      http.post(`${BASE}/auth/webauthn/reauthenticate`, async ({ request }) => {
        confirmedWith = await request.json();
        return HttpResponse.json({ status: 200, meta: { is_authenticated: true } });
      }),
      http.delete(`${BASE}/account/authenticators/webauthn`, async ({ request }) => {
        removed = await request.json();
        server.use(authenticators([]));
        return HttpResponse.json({ status: 200 });
      }),
    );
    renderWithQuery(<SecurityPanel />);
    const user = userEvent.setup();

    const list = await screen.findByRole("list", { name: "Passkeys enregistrées" });
    expect(within(list).getByText("Ajoutée le 29 octobre 2026")).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: "Retirer la passkey Téléphone" }));
    await user.click(await screen.findByRole("button", { name: "Confirmer avec une passkey" }));

    expect(await screen.findByText(PASSKEY_REMOVED)).toBeInTheDocument();
    expect(getPasskey).toHaveBeenCalledWith(REQUEST);
    expect(confirmedWith).toEqual({ credential: ASSERTION });
    expect(removed).toEqual({ authenticators: [7] });
    expect(await screen.findByText(/Connectez-vous sans mot de passe/)).toBeInTheDocument();
  });

  it("une passkey refusée demande un nouveau défi et n'exécute pas l'action", async () => {
    let challenges = 0;
    let removed = false;
    server.use(
      authenticators([phone, { type: "recovery_codes" }]),
      http.get(`${BASE}/auth/webauthn/reauthenticate`, () => {
        challenges += 1;
        return HttpResponse.json({ status: 200, data: { request_options: REQUEST } });
      }),
      http.post(`${BASE}/auth/webauthn/reauthenticate`, () =>
        HttpResponse.json(
          {
            status: 400,
            errors: [{ code: "incorrect_code", message: "Incorrect code.", param: "credential" }],
          },
          { status: 400 },
        ),
      ),
      http.delete(`${BASE}/account/authenticators/webauthn`, () => {
        removed = true;
        return HttpResponse.json({ status: 200 });
      }),
    );
    renderWithQuery(<SecurityPanel />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Retirer la passkey Téléphone" }));
    await user.click(await screen.findByRole("button", { name: "Confirmer avec une passkey" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(PASSKEY_REFUSED);
    await vi.waitFor(() => {
      expect(challenges).toBe(2);
    });
    expect(removed).toBe(false);
  });

  it("garde l'étape ouverte quand la création est annulée, puis réessaie", async () => {
    server.use(
      authenticators([]),
      http.post(`${BASE}/auth/reauthenticate`, () =>
        HttpResponse.json({ status: 200, meta: { is_authenticated: true } }),
      ),
      creationOptions(),
      http.post(`${BASE}/account/authenticators/webauthn`, () =>
        HttpResponse.json({
          status: 200,
          data: phone,
          meta: { recovery_codes_generated: false },
        }),
      ),
    );
    vi.mocked(createPasskey).mockRejectedValueOnce(new PasskeyError(PASSKEY_CANCELLED));
    renderWithQuery(<SecurityPanel />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Ajouter une passkey" }));
    await user.type(screen.getByLabelText("Mot de passe, pour confirmer"), "mot-de-passe");
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    await user.click(await screen.findByRole("button", { name: "Créer la passkey" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(PASSKEY_CANCELLED);
    await user.click(screen.getByRole("button", { name: "Créer la passkey" }));
    expect(await screen.findByText(PASSKEY_ADDED)).toBeInTheDocument();
    expect(createPasskey).toHaveBeenCalledTimes(2);
  });

  it("recharge les facteurs quand l'API exige un second facteur inattendu", async () => {
    // Une autre session a activé l'application : la liste affichée est périmée.
    let factors: object[] = [];
    server.use(
      http.get(`${BASE}/account/authenticators`, () =>
        HttpResponse.json({ status: 200, data: factors }),
      ),
      http.post(`${BASE}/auth/reauthenticate`, () =>
        HttpResponse.json({ status: 200, meta: { is_authenticated: true } }),
      ),
      http.get(`${BASE}/account/authenticators/webauthn`, () => {
        factors = [{ type: "totp" }, { type: "recovery_codes" }];
        return HttpResponse.json(
          { status: 401, data: { flows: [] }, meta: { is_authenticated: true } },
          { status: 401 },
        );
      }),
    );
    renderWithQuery(<SecurityPanel />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Ajouter une passkey" }));
    await user.type(screen.getByLabelText("Mot de passe, pour confirmer"), "mot-de-passe");
    await user.click(screen.getByRole("button", { name: "Continuer" }));

    expect(
      await screen.findByRole("textbox", {
        name: "Code de l’application ou code de secours, pour confirmer",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Mot de passe, pour confirmer")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(CONFIRM_AGAIN);
  });

  it("ne propose aucune action sans la liste des facteurs", async () => {
    server.use(
      http.get(`${BASE}/account/authenticators`, () =>
        HttpResponse.json({ status: 500 }, { status: 500 }),
      ),
    );
    renderWithQuery(<SecurityPanel />);

    expect(await screen.findByText(FACTORS_UNAVAILABLE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Activer la double authentification" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajouter une passkey" })).not.toBeInTheDocument();
  });

  it("n'envoie rien tant que le défi de passkey n'est pas enregistré", async () => {
    let answer: (() => void) | undefined;
    server.use(
      authenticators([phone, { type: "recovery_codes" }]),
      http.get(`${BASE}/auth/webauthn/reauthenticate`, async () => {
        await new Promise<void>((resolve) => (answer = resolve));
        return HttpResponse.json({ status: 200, data: { request_options: REQUEST } });
      }),
    );
    renderWithQuery(<SecurityPanel />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Ajouter une passkey" }));
    const submit = screen.getByRole("button", { name: "Continuer" });
    expect(submit).toBeDisabled();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeEnabled();

    await vi.waitFor(() => {
      expect(answer).toBeDefined();
    });
    answer?.();
    await vi.waitFor(() => {
      expect(submit).toBeEnabled();
    });
  });

  it("explique quand le navigateur ne gère pas les passkeys", async () => {
    vi.mocked(passkeysSupported).mockReturnValue(false);
    server.use(authenticators([]));
    renderWithQuery(<SecurityPanel />);

    expect(
      await screen.findByText(/Ce navigateur ne permet pas de créer de passkey/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajouter une passkey" })).not.toBeInTheDocument();
  });
});
