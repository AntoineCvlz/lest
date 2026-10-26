import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { ApiStatus } from "./api-status";

const HEALTH_URL = "*/api/v1/health/";

describe("ApiStatus", () => {
  it("annonce une API opérationnelle", async () => {
    server.use(
      http.get(HEALTH_URL, () =>
        HttpResponse.json({ status: "ok", checks: { database: "ok", cache: "ok" } }),
      ),
    );

    renderWithQuery(<ApiStatus />);

    expect(screen.getByRole("status")).toHaveTextContent("Vérification de l’API…");
    expect(await screen.findByText("API opérationnelle")).toBeInTheDocument();
  });

  it("détaille le composant en panne quand l’API est dégradée (503)", async () => {
    server.use(
      http.get(HEALTH_URL, () =>
        HttpResponse.json(
          { status: "degraded", checks: { database: "down", cache: "ok" } },
          { status: 503 },
        ),
      ),
    );

    renderWithQuery(<ApiStatus />);

    expect(await screen.findByText("API dégradée")).toBeInTheDocument();
    const database = screen.getByText("Base de données").closest("div");
    expect(database).toHaveTextContent("Indisponible");
    const cache = screen.getByText("Cache").closest("div");
    expect(cache).toHaveTextContent("Opérationnel");
  });

  it("signale une API injoignable sans afficher de détail", async () => {
    server.use(http.get(HEALTH_URL, () => HttpResponse.error()));

    renderWithQuery(<ApiStatus />);

    expect(await screen.findByText("API injoignable")).toBeInTheDocument();
    expect(screen.queryByRole("term")).not.toBeInTheDocument();
  });
});
