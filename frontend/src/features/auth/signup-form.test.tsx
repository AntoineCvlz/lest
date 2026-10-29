import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { PASSWORD_HINT, SignupForm } from "./signup-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const SIGNUP_URL = "*/api/v1/auth/app/v1/auth/signup";
const STRONG_PASSWORD = "barre-olympique-82kg"; // gitleaks:allow — mot de passe de test, pas un secret

afterEach(() => {
  push.mockReset();
});

async function submit(email: string, password: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Adresse e-mail" }), email);
  await user.type(screen.getByLabelText("Mot de passe"), password);
  await user.click(screen.getByRole("button", { name: "Créer mon compte" }));
}

describe("SignupForm", () => {
  it("affiche les règles du mot de passe sous le champ", () => {
    renderWithQuery(<SignupForm />);

    expect(screen.getByLabelText("Mot de passe")).toHaveAccessibleDescription(PASSWORD_HINT);
    expect(screen.getByLabelText("Mot de passe")).toHaveAttribute("autocomplete", "new-password");
  });

  it("crée le compte puis ouvre la saisie du code", async () => {
    let body: unknown;
    server.use(
      http.post(SIGNUP_URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { status: 401, data: { flows: [{ id: "verify_email", is_pending: true }] } },
          { status: 401 },
        );
      }),
    );
    renderWithQuery(<SignupForm />);

    await submit("nouveau@example.com", STRONG_PASSWORD);

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/verification");
    });
    expect(body).toEqual({ email: "nouveau@example.com", password: STRONG_PASSWORD });
  });

  it("relie le refus du mot de passe au champ, avec la règle et l'erreur", async () => {
    server.use(
      http.post(SIGNUP_URL, () =>
        HttpResponse.json(
          {
            status: 400,
            errors: [
              {
                code: "password_too_short",
                param: "password",
                message: "Ce mot de passe est trop court.",
              },
            ],
          },
          { status: 400 },
        ),
      ),
    );
    renderWithQuery(<SignupForm />);

    await submit("nouveau@example.com", "court");

    const password = screen.getByLabelText("Mot de passe");
    await waitFor(() => {
      expect(password).toBeInvalid();
    });
    expect(password).toHaveAccessibleDescription(
      `${PASSWORD_HINT} Ce mot de passe est trop court.`,
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("explique une limitation de débit", async () => {
    server.use(http.post(SIGNUP_URL, () => HttpResponse.json({ status: 429 }, { status: 429 })));
    renderWithQuery(<SignupForm />);

    await submit("nouveau@example.com", STRONG_PASSWORD);

    expect(await screen.findByRole("alert")).toHaveTextContent("Trop d’inscriptions");
  });
});
