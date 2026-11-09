import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { QUEUED_KEY } from "@/features/offline/queue";
import { PROFILE_QUERY_KEY } from "@/features/profile/use-profile";
import { DEVICE_SESSIONS_KEY } from "@/features/security/device-sessions";

import { OFFLINE_COPY, SessionPanel, unsentText } from "./session-panel";

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

  it("retire profil et appareils du cache quand la session a expiré", async () => {
    server.use(http.get(ME_URL, () => HttpResponse.json(UNAUTHORIZED, { status: 401 })));
    const { queryClient } = renderWithQuery(<SessionPanel />);
    // Données d'une session précédente encore en cache (même onglet, poste partagé).
    queryClient.setQueryData(PROFILE_QUERY_KEY, PROFILE);
    queryClient.setQueryData(DEVICE_SESSIONS_KEY, [{ id: 1, ip: "203.0.113.7" }]);

    await screen.findByText("Vous n’êtes pas connecté.");

    await waitFor(() => {
      expect(queryClient.getQueryData(PROFILE_QUERY_KEY)).toBeUndefined();
    });
    expect(queryClient.getQueryData(DEVICE_SESSIONS_KEY)).toBeUndefined();
  });

  it("garde les requêtes publiques quand la session a expiré (état de l'API)", async () => {
    server.use(http.get(ME_URL, () => HttpResponse.json(UNAUTHORIZED, { status: 401 })));
    const { queryClient } = renderWithQuery(<SessionPanel />);
    const health = ["get", "/api/v1/health/", {}];
    queryClient.setQueryData(health, { status: "ok" });
    queryClient.setQueryData(PROFILE_QUERY_KEY, PROFILE);

    await screen.findByText("Vous n’êtes pas connecté.");

    await waitFor(() => {
      expect(queryClient.getQueryData(PROFILE_QUERY_KEY)).toBeUndefined();
    });
    expect(queryClient.getQueryData(health)).toEqual({ status: "ok" });
  });
  it("demande avant d'abandonner des saisies en attente à la déconnexion", async () => {
    let signedOut = false;
    server.use(
      http.get(ME_URL, () => HttpResponse.json({ id: "u", email: "membre@example.com" })),
      http.delete(SESSION_URL, () => {
        signedOut = true;
        return HttpResponse.json({ status: 401 }, { status: 401 });
      }),
    );
    const user = userEvent.setup();
    const { queryClient } = renderWithQuery(<SessionPanel />);
    // Une série saisie hors ligne, pas encore envoyée.
    queryClient.getMutationCache().build(
      queryClient,
      { mutationKey: [...QUEUED_KEY, "training", "save-set"] },
      {
        context: undefined,
        data: undefined,
        error: null,
        failureCount: 0,
        failureReason: null,
        isPaused: true,
        status: "pending",
        variables: undefined,
        submittedAt: 0,
      },
    );

    await user.click(await screen.findByRole("button", { name: "Se déconnecter" }));
    expect(screen.getByText(unsentText(1))).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Attendre l’envoi" }));
    expect(signedOut).toBe(false);

    await user.click(screen.getByRole("button", { name: "Se déconnecter" }));
    await user.click(screen.getByRole("button", { name: "Abandonner et se déconnecter" }));

    await waitFor(() => {
      expect(signedOut).toBe(true);
    });
    await waitFor(() => {
      expect(queryClient.getMutationCache().getAll()).toEqual([]);
    });
  });

  it("dit que la copie hors ligne est en clair sur l'appareil", async () => {
    server.use(http.get(ME_URL, () => HttpResponse.json({ id: "u", email: "membre@example.com" })));

    renderWithQuery(<SessionPanel />);

    expect(await screen.findByText(OFFLINE_COPY)).toBeVisible();
  });
});
