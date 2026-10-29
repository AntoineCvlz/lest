import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { RATE_LIMITED, UNAVAILABLE } from "../auth/errors";
import { CODES_UNAVAILABLE, CONFIRM_AGAIN, MFA_ENABLED, SecurityPanel } from "./security-panel";

const BASE = "*/api/v1/auth/app/v1";
const SECRET = "JBSWY3DPEHPK3PXP";

function authenticators(types: string[]) {
  return http.get(`${BASE}/account/authenticators`, () =>
    HttpResponse.json({ status: 200, data: types.map((type) => ({ type })) }),
  );
}

const reauthOk = http.post(`${BASE}/auth/reauthenticate`, () =>
  HttpResponse.json({ status: 200, meta: { is_authenticated: true } }),
);

const setupSecret = http.get(`${BASE}/account/authenticators/totp`, () =>
  HttpResponse.json(
    { status: 404, meta: { secret: SECRET, totp_url: `otpauth://totp/Lest:a?secret=${SECRET}` } },
    { status: 404 },
  ),
);

async function reachSetup(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(
    await screen.findByRole("button", { name: "Activer la double authentification" }),
  );
  await user.type(screen.getByLabelText("Mot de passe, pour confirmer"), "mot-de-passe");
  await user.click(screen.getByRole("button", { name: "Continuer" }));
  await screen.findByText(SECRET);
}

describe("SecurityPanel", () => {
  it("active la double authentification : mot de passe, QR code, code, codes de secours", async () => {
    let activatedWith: unknown;
    server.use(
      authenticators([]),
      reauthOk,
      http.get(`${BASE}/account/authenticators/totp`, () =>
        HttpResponse.json(
          {
            status: 404,
            meta: { secret: SECRET, totp_url: `otpauth://totp/Lest:a?secret=${SECRET}` },
          },
          { status: 404 },
        ),
      ),
      http.post(`${BASE}/account/authenticators/totp`, async ({ request }) => {
        activatedWith = await request.json();
        return HttpResponse.json({ status: 200, data: { type: "totp" } });
      }),
      http.get(`${BASE}/account/authenticators/recovery-codes`, () =>
        HttpResponse.json({ status: 200, data: { unused_codes: ["11112222", "33334444"] } }),
      ),
    );
    renderWithQuery(<SecurityPanel />);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Activer la double authentification" }),
    );
    await user.type(screen.getByLabelText("Mot de passe, pour confirmer"), "mot-de-passe");
    await user.click(screen.getByRole("button", { name: "Continuer" }));

    expect(
      await screen.findByRole("img", { name: "QR code de configuration de l’application" }),
    ).toBeInTheDocument();
    expect(screen.getByText(SECRET)).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "Code affiché par l’application" }),
      "123 456",
    );
    await user.click(screen.getByRole("button", { name: "Activer" }));

    expect(await screen.findByRole("list", { name: "Codes de secours" })).toHaveTextContent(
      "11112222",
    );
    expect(screen.getByRole("status")).toHaveTextContent(MFA_ENABLED);
    expect(activatedWith).toEqual({ code: "123456" });
  });

  it("refuse un mot de passe faux sans afficher de secret", async () => {
    server.use(
      authenticators([]),
      http.post(`${BASE}/auth/reauthenticate`, () =>
        HttpResponse.json(
          {
            status: 400,
            errors: [
              { code: "incorrect_password", param: "password", message: "Mot de passe incorrect." },
            ],
          },
          { status: 400 },
        ),
      ),
    );
    renderWithQuery(<SecurityPanel />);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Activer la double authentification" }),
    );
    await user.type(screen.getByLabelText("Mot de passe, pour confirmer"), "faux");
    await user.click(screen.getByRole("button", { name: "Continuer" }));

    const field = screen.getByLabelText("Mot de passe, pour confirmer");
    await vi.waitFor(() => {
      expect(field).toBeInvalid();
    });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("désactive après un second facteur, jamais avec le seul mot de passe", async () => {
    let types = ["totp", "recovery_codes"];
    let codeSent: unknown;
    let passwordReauth = false;
    server.use(
      http.get(`${BASE}/account/authenticators`, () =>
        HttpResponse.json({ status: 200, data: types.map((type) => ({ type })) }),
      ),
      http.post(`${BASE}/auth/reauthenticate`, () => {
        passwordReauth = true;
        return HttpResponse.json({ status: 200 });
      }),
      http.post(`${BASE}/auth/2fa/reauthenticate`, async ({ request }) => {
        codeSent = await request.json();
        return HttpResponse.json({ status: 200, meta: { is_authenticated: true } });
      }),
      http.delete(`${BASE}/account/authenticators/totp`, () => {
        types = [];
        return HttpResponse.json({ status: 200 });
      }),
    );
    renderWithQuery(<SecurityPanel />);
    const user = userEvent.setup();

    expect(await screen.findByText(MFA_ENABLED)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Désactiver la double authentification" }));
    expect(screen.queryByLabelText("Mot de passe, pour confirmer")).not.toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", {
        name: "Code de l’application ou code de secours, pour confirmer",
      }),
      "123 456",
    );
    await user.click(screen.getByRole("button", { name: "Désactiver" }));

    expect(
      await screen.findByRole("button", { name: "Activer la double authentification" }),
    ).toBeInTheDocument();
    expect(codeSent).toEqual({ code: "123456" });
    expect(passwordReauth).toBe(false);
  });

  it("redemande la confirmation quand elle a expiré avant le premier code", async () => {
    server.use(
      authenticators([]),
      reauthOk,
      setupSecret,
      http.post(`${BASE}/account/authenticators/totp`, () =>
        HttpResponse.json(
          {
            status: 401,
            data: { flows: [{ id: "reauthenticate" }] },
            meta: { is_authenticated: true },
          },
          { status: 401 },
        ),
      ),
    );
    renderWithQuery(<SecurityPanel />);
    const user = userEvent.setup();
    await reachSetup(user);

    await user.type(
      screen.getByRole("textbox", { name: "Code affiché par l’application" }),
      "123456",
    );
    await user.click(screen.getByRole("button", { name: "Activer" }));

    expect(await screen.findByLabelText("Mot de passe, pour confirmer")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(CONFIRM_AGAIN);
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
  });

  it("ne présente jamais une liste vide de codes de secours comme définitive", async () => {
    let codesAvailable = false;
    server.use(
      authenticators([]),
      reauthOk,
      setupSecret,
      http.post(`${BASE}/account/authenticators/totp`, () =>
        HttpResponse.json({ status: 200, data: { type: "totp" } }),
      ),
      http.get(`${BASE}/account/authenticators/recovery-codes`, () =>
        codesAvailable
          ? HttpResponse.json({ status: 200, data: { unused_codes: ["55556666"] } })
          : HttpResponse.json({ status: 500 }, { status: 500 }),
      ),
    );
    renderWithQuery(<SecurityPanel />);
    const user = userEvent.setup();
    await reachSetup(user);
    await user.type(
      screen.getByRole("textbox", { name: "Code affiché par l’application" }),
      "123456",
    );
    await user.click(screen.getByRole("button", { name: "Activer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(CODES_UNAVAILABLE);
    expect(screen.queryByRole("list", { name: "Codes de secours" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "J’ai noté mes codes" })).not.toBeInTheDocument();

    codesAvailable = true;
    await user.click(screen.getByRole("button", { name: "Afficher mes codes de secours" }));
    await user.type(screen.getByLabelText("Mot de passe, pour confirmer"), "mot-de-passe");
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(await screen.findByRole("list", { name: "Codes de secours" })).toHaveTextContent(
      "55556666",
    );
  });

  it("annonce la limite de débit sur la confirmation", async () => {
    server.use(
      authenticators([]),
      http.post(`${BASE}/auth/reauthenticate`, () =>
        HttpResponse.json({ status: 429 }, { status: 429 }),
      ),
    );
    renderWithQuery(<SecurityPanel />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Activer la double authentification" }),
    );
    await user.type(screen.getByLabelText("Mot de passe, pour confirmer"), "mot-de-passe");
    await user.click(screen.getByRole("button", { name: "Continuer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(RATE_LIMITED);
  });

  it("garde Annuler inactif pendant la confirmation : aucun secret n'apparaît après coup", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      authenticators([]),
      http.post(`${BASE}/auth/reauthenticate`, async () => {
        await gate;
        return HttpResponse.json({ status: 200 });
      }),
      setupSecret,
    );
    renderWithQuery(<SecurityPanel />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Activer la double authentification" }),
    );
    await user.type(screen.getByLabelText("Mot de passe, pour confirmer"), "mot-de-passe");
    await user.click(screen.getByRole("button", { name: "Continuer" }));

    expect(screen.getByRole("button", { name: "Annuler" })).toBeDisabled();
    release();
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
  });
});
