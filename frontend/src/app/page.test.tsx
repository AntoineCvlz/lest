import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import HomePage from "./page";

const session = { active: false };
const cookies = () => ({ has: (name: string) => session.active && name === "lest_csrf" });
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookies()) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

describe("HomePage", () => {
  it("affiche le nom de l’application et l’état de l’API sans session", async () => {
    server.use(
      http.get("*/api/v1/health/", () =>
        HttpResponse.json({ status: "ok", checks: { database: "ok", cache: "ok" } }),
      ),
    );

    renderWithQuery(await HomePage());

    expect(screen.getByRole("heading", { level: 1, name: "Lest" })).toBeInTheDocument();
    expect(await screen.findByText("API opérationnelle")).toBeInTheDocument();
  });

  it("montre le Bilan et les onglets avec une session", async () => {
    session.active = true;
    server.use(
      http.get("*/api/v1/insights/dashboard/", () => new HttpResponse(null, { status: 503 })),
    );

    renderWithQuery(await HomePage());

    expect(screen.getByRole("heading", { level: 1, name: "Bilan" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bilan" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText("Bilan indisponible pour le moment.")).toBeVisible();
  });
});
