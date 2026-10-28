import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { LoginForm } from "./login-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const LOGIN_URL = "*/api/v1/auth/app/v1/auth/login";

afterEach(() => {
  push.mockReset();
});

async function submit(email: string, password: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Adresse e-mail" }), email);
  await user.type(screen.getByLabelText("Mot de passe"), password);
  // Au clavier : Entrée dans le dernier champ envoie le formulaire.
  await user.keyboard("{Enter}");
}

describe("LoginForm", () => {
  it("envoie les identifiants puis ouvre l'accueil", async () => {
    let body: unknown;
    server.use(
      http.post(LOGIN_URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: 200, meta: { is_authenticated: true } });
      }),
    );
    renderWithQuery(<LoginForm />);

    await submit("membre@example.com", "un-mot-de-passe");

    await vi.waitFor(() => {
      expect(push).toHaveBeenCalledWith("/");
    });
    expect(body).toEqual({ email: "membre@example.com", password: "un-mot-de-passe" });
  });

  it("revient sur la page privée demandée avant la connexion", async () => {
    server.use(http.post(LOGIN_URL, () => HttpResponse.json({ status: 200 })));
    renderWithQuery(<LoginForm redirectTo="/profil" />);

    await submit("membre@example.com", "un-mot-de-passe");

    await vi.waitFor(() => {
      expect(push).toHaveBeenCalledWith("/profil");
    });
  });

  it("annonce des identifiants incorrects sans quitter la page", async () => {
    server.use(
      http.post(LOGIN_URL, () =>
        HttpResponse.json(
          { status: 400, errors: [{ code: "email_password_mismatch", message: "…" }] },
          { status: 400 },
        ),
      ),
    );
    renderWithQuery(<LoginForm />);

    await submit("membre@example.com", "faux");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Adresse e-mail ou mot de passe incorrect.",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("relie l'erreur d'un champ à ce champ", async () => {
    server.use(
      http.post(LOGIN_URL, () =>
        HttpResponse.json(
          { status: 400, errors: [{ code: "invalid", param: "email", message: "…" }] },
          { status: 400 },
        ),
      ),
    );
    renderWithQuery(<LoginForm />);

    await submit("membre@", "x");

    const email = screen.getByRole("textbox", { name: "Adresse e-mail" });
    await vi.waitFor(() => {
      expect(email).toBeInvalid();
    });
    expect(email).toHaveAccessibleDescription("Saisissez une adresse e-mail valide.");
  });

  it.each([
    [429, "Trop de tentatives de connexion"],
    [503, "Le service ne répond pas pour le moment"],
  ])("explique une réponse %i", async (status, message) => {
    server.use(http.post(LOGIN_URL, () => HttpResponse.json({ status }, { status })));
    renderWithQuery(<LoginForm />);

    await submit("membre@example.com", "x");

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("envoie vers la saisie du code quand l'adresse n'est pas vérifiée (401)", async () => {
    server.use(
      http.post(LOGIN_URL, () =>
        HttpResponse.json(
          { status: 401, data: { flows: [{ id: "verify_email", is_pending: true }] } },
          { status: 401 },
        ),
      ),
    );
    renderWithQuery(<LoginForm />);

    await submit("membre@example.com", "un-mot-de-passe");

    await vi.waitFor(() => {
      expect(push).toHaveBeenCalledWith("/verification");
    });
  });

  it("envoie vers le second facteur quand la double authentification est active", async () => {
    server.use(
      http.post(LOGIN_URL, () =>
        HttpResponse.json(
          { status: 401, data: { flows: [{ id: "mfa_authenticate", is_pending: true }] } },
          { status: 401 },
        ),
      ),
    );
    renderWithQuery(<LoginForm redirectTo="/profil" />);

    await submit("membre@example.com", "un-mot-de-passe");

    await vi.waitFor(() => {
      expect(push).toHaveBeenCalledWith("/connexion/code?suivant=/profil");
    });
  });

  it("n'envoie nulle part pour un parcours inconnu", async () => {
    server.use(
      http.post(LOGIN_URL, () =>
        HttpResponse.json(
          { status: 401, data: { flows: [{ id: "autre", is_pending: true }] } },
          { status: 401 },
        ),
      ),
    );
    renderWithQuery(<LoginForm />);

    await submit("membre@example.com", "un-mot-de-passe");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Le service ne répond pas pour le moment",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("explique une panne réseau", async () => {
    server.use(http.post(LOGIN_URL, () => HttpResponse.error()));
    renderWithQuery(<LoginForm />);

    await submit("membre@example.com", "x");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Le service ne répond pas pour le moment",
    );
  });
});
