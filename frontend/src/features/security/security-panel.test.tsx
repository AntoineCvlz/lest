import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { MFA_ENABLED, SecurityPanel } from "./security-panel";

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

  it("désactive après confirmation du mot de passe", async () => {
    let types = ["totp", "recovery_codes"];
    let deleted = false;
    server.use(
      http.get(`${BASE}/account/authenticators`, () =>
        HttpResponse.json({ status: 200, data: types.map((type) => ({ type })) }),
      ),
      reauthOk,
      http.delete(`${BASE}/account/authenticators/totp`, () => {
        deleted = true;
        types = [];
        return HttpResponse.json({ status: 200 });
      }),
    );
    renderWithQuery(<SecurityPanel />);
    const user = userEvent.setup();

    expect(await screen.findByText(MFA_ENABLED)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Désactiver la double authentification" }));
    await user.type(screen.getByLabelText("Mot de passe, pour confirmer"), "mot-de-passe");
    await user.click(screen.getByRole("button", { name: "Désactiver" }));

    expect(
      await screen.findByRole("button", { name: "Activer la double authentification" }),
    ).toBeInTheDocument();
    expect(deleted).toBe(true);
  });
});
