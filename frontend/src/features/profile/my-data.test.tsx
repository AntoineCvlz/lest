import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { EXPORT_FAILED, MyData, WRONG_PASSWORD } from "./my-data";

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
  it("télécharge l'export après avoir vérifié la réponse", async () => {
    server.use(http.get("*/api/v1/me/export/", () => HttpResponse.json({ account: {} })));
    const createObjectURL = vi.fn(() => "blob:export");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    renderWithQuery(<MyData />);

    await userEvent.click(screen.getByRole("button", { name: "Télécharger mes données (JSON)" }));

    await vi.waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledOnce();
    });
    vi.unstubAllGlobals();
  });

  it("renvoie vers la connexion si la session a expiré, sans rien enregistrer", async () => {
    server.use(
      http.get("*/api/v1/me/export/", () => HttpResponse.json({ status: 401 }, { status: 401 })),
    );
    const createObjectURL = vi.fn(() => "blob:export");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    renderWithQuery(<MyData />);

    await userEvent.click(screen.getByRole("button", { name: "Télécharger mes données (JSON)" }));

    await vi.waitFor(() => {
      expect(push).toHaveBeenCalledWith("/connexion?suivant=/profil");
    });
    expect(createObjectURL).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("annonce un export impossible", async () => {
    server.use(
      http.get("*/api/v1/me/export/", () => HttpResponse.json({ status: 503 }, { status: 503 })),
    );
    renderWithQuery(<MyData />);

    await userEvent.click(screen.getByRole("button", { name: "Télécharger mes données (JSON)" }));

    expect(await screen.findByText(EXPORT_FAILED)).toBeInTheDocument();
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
    server.use(
      http.delete(ME_URL, () =>
        HttpResponse.json(
          { type: "urn:lest:problem:incorrect-password", status: 403 },
          { status: 403 },
        ),
      ),
    );
    renderWithQuery(<MyData />);

    await confirmWith("faux");

    const field = screen.getByLabelText("Mot de passe, pour confirmer");
    await vi.waitFor(() => {
      expect(field).toBeInvalid();
    });
    expect(field).toHaveAccessibleDescription(WRONG_PASSWORD);
    expect(push).not.toHaveBeenCalled();
  });

  it("ne confond pas un autre refus (CSRF) avec un mot de passe faux", async () => {
    server.use(
      http.delete(ME_URL, () =>
        HttpResponse.json(
          { type: "about:blank", title: "Forbidden", status: 403 },
          { status: 403 },
        ),
      ),
    );
    renderWithQuery(<MyData />);

    await confirmWith("le-bon");

    expect(await screen.findByText(/n’a pas pu être supprimé/)).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe, pour confirmer")).not.toBeInvalid();
  });

  it("ne garde pas le mot de passe dans le cache des mutations", async () => {
    server.use(http.delete(ME_URL, () => HttpResponse.json({ status: 429 }, { status: 429 })));
    const { queryClient } = renderWithQuery(<MyData />);

    await confirmWith("secret-saisi");
    await screen.findByText(/Trop de tentatives/);

    const cached = queryClient.getMutationCache().getAll();
    expect(JSON.stringify(cached.map((mutation) => mutation.state))).not.toContain("secret-saisi");
  });

  it("annonce une limitation de tentatives", async () => {
    server.use(http.delete(ME_URL, () => HttpResponse.json({ status: 429 }, { status: 429 })));
    renderWithQuery(<MyData />);

    await confirmWith("faux");

    expect(await screen.findByText(/Trop de tentatives/)).toBeInTheDocument();
  });

  it("permet d'annuler la confirmation", async () => {
    renderWithQuery(<MyData />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Supprimer mon compte" }));
    await user.click(screen.getByRole("button", { name: "Annuler" }));

    expect(screen.queryByLabelText("Mot de passe, pour confirmer")).not.toBeInTheDocument();
  });
});
