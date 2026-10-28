import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { MyData, WRONG_PASSWORD } from "./my-data";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const ME_URL = "*/api/v1/me/";

afterEach(() => {
  push.mockReset();
});

async function confirmWith(password: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Supprimer mon compte" }));
  await user.type(screen.getByLabelText("Mot de passe, pour confirmer"), password);
  await user.click(screen.getByRole("button", { name: "Supprimer définitivement mon compte" }));
}

describe("MyData", () => {
  it("propose le téléchargement des données en JSON", () => {
    renderWithQuery(<MyData />);

    const link = screen.getByRole("link", { name: "Télécharger mes données (JSON)" });
    expect(link).toHaveAttribute("href", "/api/v1/me/export/");
    expect(link).toHaveAttribute("download");
  });

  it("demande le mot de passe avant de supprimer, puis vide le cache et quitte la page", async () => {
    let body: unknown;
    server.use(
      http.delete(ME_URL, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { queryClient } = renderWithQuery(<MyData />);
    queryClient.setQueryData(["profile"], { height_m: 1.8 });

    expect(screen.queryByLabelText("Mot de passe, pour confirmer")).not.toBeInTheDocument();
    await confirmWith("mon-mot-de-passe");

    await vi.waitFor(() => {
      expect(push).toHaveBeenCalledWith("/compte-supprime");
    });
    expect(body).toEqual({ password: "mon-mot-de-passe" });
    expect(queryClient.getQueryData(["profile"])).toBeUndefined();
  });

  it("rattache un mot de passe faux au champ, sans rien supprimer", async () => {
    server.use(http.delete(ME_URL, () => HttpResponse.json({ status: 403 }, { status: 403 })));
    renderWithQuery(<MyData />);

    await confirmWith("faux");

    const field = screen.getByLabelText("Mot de passe, pour confirmer");
    await vi.waitFor(() => {
      expect(field).toBeInvalid();
    });
    expect(field).toHaveAccessibleDescription(WRONG_PASSWORD);
    expect(push).not.toHaveBeenCalled();
  });

  it("annonce une limitation de tentatives", async () => {
    server.use(http.delete(ME_URL, () => HttpResponse.json({ status: 429 }, { status: 429 })));
    renderWithQuery(<MyData />);

    await confirmWith("faux");

    expect(await screen.findByRole("alert")).toHaveTextContent("Trop de tentatives");
  });

  it("permet d'annuler la confirmation", async () => {
    renderWithQuery(<MyData />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Supprimer mon compte" }));
    await user.click(screen.getByRole("button", { name: "Annuler" }));

    expect(screen.queryByLabelText("Mot de passe, pour confirmer")).not.toBeInTheDocument();
  });
});
