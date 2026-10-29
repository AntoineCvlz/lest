import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import type * as Webauthn from "@/shared/lib/webauthn";
import {
  getPasskey,
  PASSKEY_CANCELLED,
  PasskeyError,
  passkeysSupported,
} from "@/shared/lib/webauthn";
import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { RATE_LIMITED } from "./errors";
import { LoginForm, PASSKEY_UNKNOWN } from "./login-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
// Cérémonie du navigateur testée dans `webauthn.test.ts` et en E2E ; ici, son résultat.
vi.mock("@/shared/lib/webauthn", async (importOriginal) => ({
  ...(await importOriginal<typeof Webauthn>()),
  passkeysSupported: vi.fn(() => true),
  getPasskey: vi.fn(),
}));

const URL = "*/api/v1/auth/app/v1/auth/webauthn/login";
const OPTIONS = { publicKey: { challenge: "Y2hhbGxlbmdl" } };
const ASSERTION = { id: "cle", response: { signature: "AA" } };

const options = http.get(URL, () =>
  HttpResponse.json({ status: 200, data: { request_options: OPTIONS } }),
);

beforeEach(() => {
  vi.mocked(passkeysSupported).mockReturnValue(true);
  vi.mocked(getPasskey).mockResolvedValue(ASSERTION);
});

afterEach(() => {
  push.mockReset();
});

async function clickPasskey(): Promise<void> {
  await userEvent.click(
    await screen.findByRole("button", { name: "Se connecter avec une passkey" }),
  );
}

describe("LoginForm, passkey", () => {
  it("connecte sans mot de passe puis ouvre la page demandée", async () => {
    let body: unknown;
    server.use(
      options,
      http.post(URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: 200, meta: { is_authenticated: true } });
      }),
    );
    renderWithQuery(<LoginForm redirectTo="/profil" />);

    await clickPasskey();

    await vi.waitFor(() => {
      expect(push).toHaveBeenCalledWith("/profil");
    });
    expect(getPasskey).toHaveBeenCalledWith(OPTIONS);
    expect(body).toEqual({ credential: ASSERTION });
  });

  it("annonce une passkey inconnue sans quitter la page", async () => {
    server.use(
      options,
      http.post(URL, () =>
        HttpResponse.json(
          {
            status: 400,
            errors: [{ code: "incorrect_code", message: "Incorrect code.", param: "credential" }],
          },
          { status: 400 },
        ),
      ),
    );
    renderWithQuery(<LoginForm />);

    await clickPasskey();

    expect(await screen.findByRole("alert")).toHaveTextContent(PASSKEY_UNKNOWN);
    expect(push).not.toHaveBeenCalled();
  });

  it("une annulation n'envoie rien", async () => {
    let posted = false;
    server.use(
      options,
      http.post(URL, () => {
        posted = true;
        return HttpResponse.json({ status: 200 });
      }),
    );
    vi.mocked(getPasskey).mockRejectedValue(new PasskeyError(PASSKEY_CANCELLED));
    renderWithQuery(<LoginForm />);

    await clickPasskey();

    expect(await screen.findByRole("alert")).toHaveTextContent(PASSKEY_CANCELLED);
    expect(posted).toBe(false);
  });

  it("annonce la limite de débit des demandes de passkey", async () => {
    server.use(http.get(URL, () => HttpResponse.json({ status: 429 }, { status: 429 })));
    renderWithQuery(<LoginForm />);

    await clickPasskey();

    expect(await screen.findByRole("alert")).toHaveTextContent(RATE_LIMITED);
    expect(getPasskey).not.toHaveBeenCalled();
  });

  it("ne garde pas le mot de passe en mémoire après un refus", async () => {
    server.use(
      http.post("*/api/v1/auth/app/v1/auth/login", () =>
        HttpResponse.json(
          { status: 400, errors: [{ code: "email_password_mismatch", param: "password" }] },
          { status: 400 },
        ),
      ),
    );
    const { queryClient, unmount } = renderWithQuery(<LoginForm />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Adresse e-mail" }), "a@example.com");
    await user.type(screen.getByLabelText("Mot de passe"), "secret-de-test");
    await user.keyboard("{Enter}");
    await screen.findByRole("alert");

    unmount();

    await vi.waitFor(() => {
      expect(
        JSON.stringify(
          queryClient
            .getMutationCache()
            .getAll()
            .map((m) => m.state),
        ),
      ).not.toContain("secret-de-test");
    });
  });

  it("ne propose pas de passkey à un navigateur qui n'en gère pas", async () => {
    vi.mocked(passkeysSupported).mockReturnValue(false);
    renderWithQuery(<LoginForm />);

    expect(await screen.findByRole("button", { name: "Se connecter" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Se connecter avec une passkey" }),
    ).not.toBeInTheDocument();
  });
});
