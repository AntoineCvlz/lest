import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { ProfileForm, SAVED } from "./profile-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const PROFILE_URL = "*/api/v1/me/profile/";

afterEach(() => {
  push.mockReset();
});

function capturePut(status = 200): () => unknown {
  let body: unknown;
  server.use(
    http.put(PROFILE_URL, async ({ request }) => {
      body = await request.json();
      return HttpResponse.json(
        {
          height_m: 1.8,
          goal: "gain",
          unit_system: "metric",
          onboarded_at: "2026-10-28T09:00:00Z",
        },
        { status },
      );
    }),
  );
  return () => body;
}

describe("ProfileForm", () => {
  it("enregistre l'objectif et la taille en mètres, puis poursuit l'onboarding", async () => {
    const body = capturePut();
    renderWithQuery(<ProfileForm submitLabel="Commencer" redirectTo="/" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: "Prise de masse" }));
    await user.type(screen.getByRole("textbox", { name: "Taille (cm)" }), "180");
    await user.click(screen.getByRole("button", { name: "Commencer" }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/");
    });
    expect(body()).toEqual({ goal: "gain", unit_system: "metric", height_m: 1.8 });
  });

  it("convertit la taille saisie quand on change d'unités", async () => {
    const body = capturePut();
    renderWithQuery(<ProfileForm submitLabel="Commencer" redirectTo="/" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: "Sèche" }));
    await user.type(screen.getByRole("textbox", { name: "Taille (cm)" }), "180");
    await user.click(screen.getByRole("radio", { name: "lb, ft" }));

    expect(screen.getByRole("textbox", { name: "Pieds" })).toHaveValue("5");
    expect(screen.getByRole("textbox", { name: "Pouces" })).toHaveValue("11");
    await user.click(screen.getByRole("button", { name: "Commencer" }));
    await waitFor(() => {
      expect(body()).toEqual({ goal: "cut", unit_system: "imperial", height_m: 1.8 });
    });
  });

  it("signale une taille ou un objectif manquants sans rien envoyer", async () => {
    const body = capturePut();
    renderWithQuery(<ProfileForm submitLabel="Commencer" redirectTo="/" />);

    await userEvent.click(screen.getByRole("button", { name: "Commencer" }));

    expect(await screen.findByText("Choisissez un objectif.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Taille (cm)" })).toHaveAccessibleDescription(
      "Saisissez une taille entre 100 et 250 cm.",
    );
    expect(body()).toBeUndefined();
  });

  it("pré-remplit un profil existant et confirme l'enregistrement sur place", async () => {
    capturePut();
    renderWithQuery(
      <ProfileForm
        initial={{
          height_m: 1.8,
          goal: "maintain",
          unit_system: "metric",
          one_rm_formula: "epley",
          onboarded_at: "2026-10-28T09:00:00Z",
        }}
        submitLabel="Enregistrer"
      />,
    );

    expect(screen.getByRole("radio", { name: "Maintien" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Taille (cm)" })).toHaveValue("180");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByRole("status")).toHaveTextContent(SAVED);
    expect(push).not.toHaveBeenCalled();
  });

  it("demande de se reconnecter si la session a expiré", async () => {
    capturePut(401);
    renderWithQuery(<ProfileForm submitLabel="Commencer" redirectTo="/" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: "Maintien" }));
    await user.type(screen.getByRole("textbox", { name: "Taille (cm)" }), "175");
    await user.click(screen.getByRole("button", { name: "Commencer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("reconnectez-vous");
    expect(push).not.toHaveBeenCalled();
  });
});
