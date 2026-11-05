import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { localDay, longDay } from "@/shared/lib/days";
import { BasicFitSection, failureText } from "./basicfit-section";
import { BasicFitRequestFailed, type Connection } from "./use-basicfit";

const NONE: Connection = {
  enabled: true,
  status: "none",
  connected_at: null,
  last_sync_at: null,
  last_error: "",
  home_club: "",
};
const LINKED: Connection = {
  ...NONE,
  status: "connected",
  connected_at: "2026-11-01T10:00:00Z",
  last_sync_at: "2026-11-05T08:30:00Z",
  home_club: "Club témoin",
};
// Adresses fictives : aucune vraie réponse Basic-Fit.
const AUTHORIZE = "https://login.basic-fit.com/login?state=etat-fictif";
const REDIRECT = "com.basicfit.trainingapp:/oauthredirect?code=code-fictif&state=etat-fictif";

function api(connection: Connection) {
  const sent: { complete?: unknown; synced: number; deleted: number } = { synced: 0, deleted: 0 };
  server.use(
    http.get("*/api/v1/basicfit/connection/", () => HttpResponse.json(connection)),
    http.get("*/api/v1/basicfit/visits/", () =>
      HttpResponse.json([{ date: localDay(), club: "Club témoin" }]),
    ),
    http.post("*/api/v1/basicfit/connection/start/", () =>
      HttpResponse.json({ authorize_url: AUTHORIZE }),
    ),
    http.post("*/api/v1/basicfit/connection/complete/", async ({ request }) => {
      sent.complete = await request.json();
      return HttpResponse.json(LINKED);
    }),
    http.post("*/api/v1/basicfit/sync/", () => {
      sent.synced += 1;
      return HttpResponse.json({ queued: true }, { status: 202 });
    }),
    http.delete("*/api/v1/basicfit/connection/", () => {
      sent.deleted += 1;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return sent;
}

describe("BasicFitSection", () => {
  it("n'apparaît pas quand l'intégration est désactivée", async () => {
    api({ ...NONE, enabled: false, status: "disabled" });
    const { container } = renderWithQuery(<BasicFitSection />);

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it("relie le compte en deux étapes, avec l'avertissement et ce qui est importé", async () => {
    const sent = api(NONE);
    const user = userEvent.setup();
    renderWithQuery(<BasicFitSection />);

    expect(await screen.findByText(/Ne transmettez jamais cette adresse/)).toBeVisible();
    expect(screen.getByText(/poids mesuré par les balances du club/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Préparer la connexion" }));
    const link = await screen.findByRole("link", { name: /^Ouvrir la connexion Basic-Fit/ });
    expect(link).toHaveAttribute("href", AUTHORIZE);
    expect(link).toHaveAttribute("rel", "noopener noreferrer");

    await user.type(screen.getByRole("textbox", { name: "Adresse de redirection" }), REDIRECT);
    await user.click(screen.getByRole("button", { name: "Relier mon compte" }));

    expect(await screen.findByText(/^Compte Basic-Fit relié\./)).toBeVisible();
    expect(sent.complete).toEqual({ redirect_url: REDIRECT });
  });

  it("met le focus sur l'adresse quand elle manque", async () => {
    const sent = api(NONE);
    const user = userEvent.setup();
    renderWithQuery(<BasicFitSection />);

    await user.click(await screen.findByRole("button", { name: "Relier mon compte" }));

    const field = screen.getByRole("textbox", { name: "Adresse de redirection" });
    expect(field).toHaveFocus();
    expect(field).toHaveAccessibleDescription("Collez l’adresse copiée après la connexion.");
    expect(sent.complete).toBeUndefined();
  });

  it("explique un refus sans reprendre l'adresse collée", async () => {
    api(NONE);
    server.use(
      http.post("*/api/v1/basicfit/connection/complete/", () =>
        HttpResponse.json(
          { type: "urn:lest:problem:basicfit-redirect-refused", status: 422 },
          { status: 422, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithQuery(<BasicFitSection />);

    await user.type(
      await screen.findByRole("textbox", { name: "Adresse de redirection" }),
      REDIRECT,
    );
    await user.click(screen.getByRole("button", { name: "Relier mon compte" }));

    const alert = await screen.findByText(/^Adresse refusée/);
    expect(alert).toBeVisible();
    expect(alert).not.toHaveTextContent("code-fictif");
  });

  it("montre le club, les visites, synchronise et délie après confirmation", async () => {
    const sent = api(LINKED);
    const user = userEvent.setup();
    renderWithQuery(<BasicFitSection />);

    expect(await screen.findByText("Club témoin", { selector: "dd" })).toBeVisible();
    expect(await screen.findByText(longDay(localDay()))).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Synchroniser maintenant" }));
    expect(await screen.findByText(/^Synchronisation demandée/)).toBeVisible();
    expect(sent.synced).toBe(1);

    await user.click(screen.getByRole("button", { name: "Délier Basic-Fit" }));
    expect(screen.getByRole("button", { name: "Garder" })).toHaveFocus();
    expect(screen.getByText(/depuis leur application/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Délier" }));

    expect(await screen.findByText("Compte Basic-Fit délié.")).toBeVisible();
    expect(sent.deleted).toBe(1);
  });

  it("demande de relier à nouveau un compte refusé par Basic-Fit", async () => {
    api({ ...LINKED, status: "expired" });
    renderWithQuery(<BasicFitSection />);

    expect(await screen.findByText(/reliez à nouveau votre compte/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Préparer la connexion" })).toBeVisible();
  });
});

describe("failureText", () => {
  it("traduit chaque refus de l'API", () => {
    expect(failureText(new BasicFitRequestFailed(429, "urn:lest:problem:basicfit-too-soon"))).toBe(
      "Synchronisation déjà demandée il y a moins d’une heure.",
    );
    expect(failureText(new BasicFitRequestFailed(503))).toBe(
      "Basic-Fit ne répond pas. Réessayez plus tard.",
    );
    expect(failureText(new BasicFitRequestFailed(429))).toBe(
      "Trop de tentatives. Réessayez plus tard.",
    );
    expect(failureText(new Error("autre"))).toBe("Liaison Basic-Fit indisponible pour le moment.");
  });
});
