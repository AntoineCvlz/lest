import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import type * as Webauthn from "@/shared/lib/webauthn";
import { getPasskey, passkeysSupported } from "@/shared/lib/webauthn";
import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { NO_PENDING_LOGIN, PASSKEY_REFUSED, SecondFactorForm } from "./second-factor-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/shared/lib/webauthn", async (importOriginal) => ({
  ...(await importOriginal<typeof Webauthn>()),
  passkeysSupported: vi.fn(() => true),
  getPasskey: vi.fn(),
}));

const BASE = "*/api/v1/auth/app/v1/auth";
const OPTIONS = { publicKey: { challenge: "Y2hhbGxlbmdl" } };
const ASSERTION = { id: "cle", response: { signature: "AA" } };

function pending(types: string[]) {
  return http.get(`${BASE}/session`, () =>
    HttpResponse.json(
      { status: 401, data: { flows: [{ id: "mfa_authenticate", is_pending: true, types }] } },
      { status: 401 },
    ),
  );
}

beforeEach(() => {
  vi.mocked(passkeysSupported).mockReturnValue(true);
  vi.mocked(getPasskey).mockResolvedValue(ASSERTION);
});

afterEach(() => {
  push.mockReset();
});

describe("SecondFactorForm, passkey", () => {
  it("valide la connexion avec une passkey, en action principale sans application", async () => {
    let body: unknown;
    server.use(
      pending(["recovery_codes", "webauthn"]),
      http.get(`${BASE}/webauthn/authenticate`, () =>
        HttpResponse.json({ status: 200, data: { request_options: OPTIONS } }),
      ),
      http.post(`${BASE}/webauthn/authenticate`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: 200, meta: { is_authenticated: true } });
      }),
    );
    renderWithQuery(<SecondFactorForm redirectTo="/profil" />);

    const passkey = await screen.findByRole("button", { name: "Utiliser une passkey" });
    await waitFor(() => {
      expect(passkey).toBeEnabled();
    });
    expect(screen.getByText(/L’un de vos codes de secours/)).toBeInTheDocument();
    await userEvent.click(passkey);

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/profil");
    });
    expect(getPasskey).toHaveBeenCalledWith(OPTIONS);
    expect(body).toEqual({ credential: ASSERTION });
  });

  it("une passkey refusée demande un nouveau défi", async () => {
    let challenges = 0;
    server.use(
      pending(["totp", "recovery_codes", "webauthn"]),
      http.get(`${BASE}/webauthn/authenticate`, () => {
        challenges += 1;
        return HttpResponse.json({ status: 200, data: { request_options: OPTIONS } });
      }),
      http.post(`${BASE}/webauthn/authenticate`, () =>
        HttpResponse.json(
          {
            status: 400,
            errors: [{ code: "incorrect_code", message: "Incorrect code.", param: "credential" }],
          },
          { status: 400 },
        ),
      ),
    );
    renderWithQuery(<SecondFactorForm />);

    const passkey = await screen.findByRole("button", { name: "Utiliser une passkey" });
    await waitFor(() => {
      expect(passkey).toBeEnabled();
    });
    await userEvent.click(passkey);

    expect(await screen.findByRole("alert")).toHaveTextContent(PASSKEY_REFUSED);
    await waitFor(() => {
      expect(challenges).toBe(2);
    });
    expect(push).not.toHaveBeenCalled();
  });

  it("ne propose pas de passkey à un compte qui n'en a pas", async () => {
    server.use(pending(["totp", "recovery_codes"]));
    renderWithQuery(<SecondFactorForm />);

    expect(await screen.findByText(/Le code à 6 chiffres/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Valider" })).toBeEnabled();
    });
    expect(screen.queryByRole("button", { name: "Utiliser une passkey" })).not.toBeInTheDocument();
  });

  it("une connexion expirée renvoie vers l'e-mail et le mot de passe", async () => {
    server.use(
      pending(["recovery_codes", "webauthn"]),
      http.get(`${BASE}/webauthn/authenticate`, () =>
        HttpResponse.json({ status: 200, data: { request_options: OPTIONS } }),
      ),
      http.post(`${BASE}/webauthn/authenticate`, () =>
        HttpResponse.json({ status: 409 }, { status: 409 }),
      ),
    );
    renderWithQuery(<SecondFactorForm />);

    const passkey = await screen.findByRole("button", { name: "Utiliser une passkey" });
    await waitFor(() => {
      expect(passkey).toBeEnabled();
    });
    await userEvent.click(passkey);

    expect(await screen.findByRole("alert")).toHaveTextContent(NO_PENDING_LOGIN);
  });
});
