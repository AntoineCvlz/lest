import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { PROFILE_QUERY_KEY } from "@/features/profile/use-profile";

import { SessionPanel } from "./session-panel";

const ME_URL = "*/api/v1/me/";
const SESSION_URL = "*/api/v1/auth/app/v1/auth/session";
const UNAUTHORIZED = { type: "about:blank", title: "Unauthorized", status: 401 };

describe("SessionPanel", () => {
  it("invite à se connecter sans session", async () => {
    server.use(http.get(ME_URL, () => HttpResponse.json(UNAUTHORIZED, { status: 401 })));

    renderWithQuery(<SessionPanel />);

    expect(await screen.findByText("Vous n’êtes pas connecté.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute(
      "href",
      "/connexion",
    );
  });

  it("affiche le compte puis le déconnecte", async () => {
    let signedIn = true;
    server.use(
      http.get(ME_URL, () =>
        signedIn
          ? HttpResponse.json({ id: "u", email: "membre@example.com" })
          : HttpResponse.json(UNAUTHORIZED, { status: 401 }),
      ),
      http.delete(SESSION_URL, () => {
        signedIn = false;
        return HttpResponse.json({ status: 401 }, { status: 401 });
      }),
    );
    renderWithQuery(<SessionPanel />);

    expect(await screen.findByText("Connecté avec membre@example.com")).toHaveRole("status");
    await userEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));

    expect(await screen.findByText("Vous n’êtes pas connecté.")).toBeInTheDocument();
  });

  it.each([403, 503])(
    "signale une déconnexion refusée (%i) sans masquer la session",
    async (status) => {
      server.use(
        http.get(ME_URL, () => HttpResponse.json({ id: "u", email: "membre@example.com" })),
        http.delete(SESSION_URL, () => HttpResponse.json({ status }, { status })),
      );
      renderWithQuery(<SessionPanel />);

      await userEvent.click(await screen.findByRole("button", { name: "Se déconnecter" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Déconnexion impossible");
      expect(screen.getByText("Connecté avec membre@example.com")).toBeInTheDocument();
    },
  );
});

describe("SessionPanel et profil", () => {
  it.each([
    [404, "Compléter mon profil", "/bienvenue"],
    [200, "Mon profil", "/profil"],
  ])("propose le bon lien de profil (profil en %i)", async (status, name, href) => {
    server.use(
      http.get(ME_URL, () => HttpResponse.json({ id: "u", email: "membre@example.com" })),
      http.get("*/api/v1/me/profile/", () =>
        status === 404
          ? HttpResponse.json({ status: 404 }, { status: 404 })
          : HttpResponse.json({
              height_m: 1.8,
              goal: "gain",
              unit_system: "metric",
              onboarded_at: "2026-10-28T09:00:00Z",
            }),
      ),
    );

    renderWithQuery(<SessionPanel />);

    expect(await screen.findByRole("link", { name })).toHaveAttribute("href", href);
  });
});

describe("SessionPanel et cache des données de santé", () => {
  const PROFILE = {
    height_m: 1.8,
    goal: "gain",
    unit_system: "metric",
    onboarded_at: "2026-10-28T09:00:00Z",
  };

  it("retire le profil du cache à la déconnexion", async () => {
    let signedIn = true;
    server.use(
      http.get(ME_URL, () =>
        signedIn
          ? HttpResponse.json({ id: "u", email: "membre@example.com" })
          : HttpResponse.json(UNAUTHORIZED, { status: 401 }),
      ),
      http.get("*/api/v1/me/profile/", () => HttpResponse.json(PROFILE)),
      http.delete(SESSION_URL, () => {
        signedIn = false;
        return HttpResponse.json({ status: 401 }, { status: 401 });
      }),
    );
    const { queryClient } = renderWithQuery(<SessionPanel />);
    await screen.findByRole("link", { name: "Mon profil" });
    expect(queryClient.getQueryData(PROFILE_QUERY_KEY)).toEqual(PROFILE);

    await userEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));

    await screen.findByText("Vous n’êtes pas connecté.");
    expect(queryClient.getQueryData(PROFILE_QUERY_KEY)).toBeUndefined();
  });

  it("retire le profil du cache quand la session a expiré", async () => {
    server.use(http.get(ME_URL, () => HttpResponse.json(UNAUTHORIZED, { status: 401 })));
    const { queryClient } = renderWithQuery(<SessionPanel />);
    // Profil d'une session précédente encore en cache (même onglet, poste partagé).
    queryClient.setQueryData(PROFILE_QUERY_KEY, PROFILE);

    await screen.findByText("Vous n’êtes pas connecté.");

    await waitFor(() => {
      expect(queryClient.getQueryData(PROFILE_QUERY_KEY)).toBeUndefined();
    });
  });
});
