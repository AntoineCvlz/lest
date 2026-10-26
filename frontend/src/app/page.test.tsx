import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import HomePage from "./page";

describe("HomePage", () => {
  it("affiche le nom de l’application comme titre principal et l’état de l’API", async () => {
    server.use(
      http.get("*/api/v1/health/", () =>
        HttpResponse.json({ status: "ok", checks: { database: "ok", cache: "ok" } }),
      ),
    );

    renderWithQuery(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Lest" })).toBeInTheDocument();
    expect(await screen.findByText("API opérationnelle")).toBeInTheDocument();
  });
});
