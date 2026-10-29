import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { ForgotPasswordForm } from "./forgot-password-form";
import { NO_PENDING_RESET, RESET_DONE, ResetPasswordForm } from "./reset-password-form";
import { PASSWORD_HINT } from "./signup-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const REQUEST_URL = "*/api/v1/auth/app/v1/auth/password/request";
const RESET_URL = "*/api/v1/auth/app/v1/auth/password/reset";
const NEW_PASSWORD = "disque-de-fonte-25kg"; // gitleaks:allow — mot de passe de test, pas un secret

afterEach(() => {
  push.mockReset();
});

describe("ForgotPasswordForm", () => {
  it.each([200, 401])("envoie vers la saisie du code (réponse %i)", async (status) => {
    let body: unknown;
    server.use(
      http.post(REQUEST_URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status }, { status });
      }),
    );
    renderWithQuery(<ForgotPasswordForm />);

    await userEvent.type(
      screen.getByRole("textbox", { name: "Adresse e-mail" }),
      "membre@example.com{Enter}",
    );

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/mot-de-passe-oublie/code");
    });
    expect(body).toEqual({ email: "membre@example.com" });
  });

  it("relie une adresse invalide au champ", async () => {
    server.use(
      http.post(REQUEST_URL, () =>
        HttpResponse.json(
          { status: 400, errors: [{ code: "invalid", param: "email", message: "…" }] },
          { status: 400 },
        ),
      ),
    );
    renderWithQuery(<ForgotPasswordForm />);

    await userEvent.type(screen.getByRole("textbox", { name: "Adresse e-mail" }), "x{Enter}");

    const email = screen.getByRole("textbox", { name: "Adresse e-mail" });
    await waitFor(() => {
      expect(email).toBeInvalid();
    });
    expect(push).not.toHaveBeenCalled();
  });
});

async function submitReset(code: string, password: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Code reçu par e-mail" }), code);
  await user.type(screen.getByLabelText("Nouveau mot de passe"), password);
  await user.click(screen.getByRole("button", { name: "Changer le mot de passe" }));
}

describe("ResetPasswordForm", () => {
  it("affiche les règles du nouveau mot de passe", () => {
    renderWithQuery(<ResetPasswordForm />);

    expect(screen.getByLabelText("Nouveau mot de passe")).toHaveAccessibleDescription(
      PASSWORD_HINT,
    );
  });

  it("change le mot de passe puis propose de se connecter (401)", async () => {
    let body: unknown;
    server.use(
      http.post(RESET_URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: 401 }, { status: 401 });
      }),
    );
    renderWithQuery(<ResetPasswordForm />);

    await submitReset(" abcd-efgh ", NEW_PASSWORD);

    expect(await screen.findByRole("status")).toHaveTextContent(RESET_DONE);
    expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute(
      "href",
      "/connexion",
    );
    expect(body).toEqual({ key: "ABCD-EFGH", password: NEW_PASSWORD });
  });

  it("ouvre l'accueil si allauth connecte directement (200)", async () => {
    server.use(http.post(RESET_URL, () => HttpResponse.json({ status: 200 })));
    renderWithQuery(<ResetPasswordForm />);

    await submitReset("ABCD-EFGH", NEW_PASSWORD);

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/");
    });
  });

  it("rattache un code incorrect et un mot de passe refusé à leurs champs", async () => {
    server.use(
      http.post(RESET_URL, () =>
        HttpResponse.json(
          {
            status: 400,
            errors: [
              { code: "incorrect_code", param: "key", message: "…" },
              { code: "password_too_short", param: "password", message: "Trop court." },
            ],
          },
          { status: 400 },
        ),
      ),
    );
    renderWithQuery(<ResetPasswordForm />);

    await submitReset("ABCD-0000", "court");

    const code = screen.getByRole("textbox", { name: "Code reçu par e-mail" });
    await waitFor(() => {
      expect(code).toBeInvalid();
    });
    expect(screen.getByLabelText("Nouveau mot de passe")).toHaveAccessibleDescription(
      `${PASSWORD_HINT} Trop court.`,
    );
  });

  it("explique qu'aucune réinitialisation n'est en cours (409)", async () => {
    server.use(http.post(RESET_URL, () => HttpResponse.json({ status: 409 }, { status: 409 })));
    renderWithQuery(<ResetPasswordForm />);

    await submitReset("ABCD-EFGH", NEW_PASSWORD);

    expect(await screen.findByRole("alert")).toHaveTextContent(NO_PENDING_RESET);
  });
});
