import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { FoodJournal } from "./food-journal";
import { NutritionTargets } from "./nutrition-targets";

const COMPUTED = { kcal: 3030, protein_g: 160, carbs_g: 436, fat_g: 72 };
const INPUTS = {
  sex: "male",
  birth_date: "1996-11-04",
  activity: "moderate",
  kcal: null,
  protein_g: null,
  carbs_g: null,
  fat_g: null,
};

function targetsApi(initial: object) {
  let sent: unknown;
  server.use(
    http.get("*/api/v1/nutrition/targets/", () => HttpResponse.json(initial)),
    http.put("*/api/v1/nutrition/targets/", async ({ request }) => {
      sent = await request.json();
      return HttpResponse.json({
        configured: true,
        inputs: sent,
        computed: COMPUTED,
        targets: { ...COMPUTED, kcal: (sent as { kcal: number | null }).kcal ?? COMPUTED.kcal },
        missing: [],
      });
    }),
  );
  return () => sent;
}

const NOT_CONFIGURED = {
  configured: false,
  inputs: null,
  computed: null,
  targets: null,
  missing: [],
};

describe("NutritionTargets", () => {
  it("active les objectifs et affiche les valeurs retenues", async () => {
    const sent = targetsApi(NOT_CONFIGURED);
    const user = userEvent.setup();
    renderWithQuery(<NutritionTargets />);

    const group = await screen.findByRole("group", { name: "Formule de calcul" });
    await user.click(within(group).getByRole("radio", { name: "Formule masculine" }));
    await user.type(screen.getByLabelText("Date de naissance"), "1996-11-04");
    await user.selectOptions(screen.getByLabelText("Niveau d’activité"), "light");
    await user.click(screen.getByRole("button", { name: "Activer mes objectifs" }));

    expect(await screen.findByText("Objectifs enregistrés.")).toBeVisible();
    // Le formulaire n'est pas recréé : le focus reste sur le bouton.
    expect(screen.getByRole("button", { name: "Enregistrer les objectifs" })).toHaveFocus();
    expect(sent()).toEqual({
      sex: "male",
      birth_date: "1996-11-04",
      activity: "light",
      kcal: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
    });
    const chosen = screen.getByRole("heading", { name: "Objectifs retenus" }).parentElement;
    expect(chosen).toHaveTextContent(/3\s030\skcal/);
  });

  it("garde le calcul en aide et envoie une surcharge", async () => {
    const sent = targetsApi({
      configured: true,
      inputs: INPUTS,
      computed: COMPUTED,
      targets: COMPUTED,
      missing: [],
    });
    const user = userEvent.setup();
    renderWithQuery(<NutritionTargets />);

    const kcal = await screen.findByRole("textbox", { name: "Énergie (kcal)" });
    expect(kcal).toHaveAccessibleDescription("Calcul : 3 030 kcal");
    await user.type(kcal, "3200");
    await user.click(screen.getByRole("button", { name: "Enregistrer les objectifs" }));

    await waitFor(() => {
      expect(sent()).toMatchObject({ kcal: 3200, protein_g: null });
    });
  });

  it("refuse une valeur hors bornes et une formule manquante", async () => {
    const sent = targetsApi(NOT_CONFIGURED);
    const user = userEvent.setup();
    renderWithQuery(<NutritionTargets />);

    await user.type(await screen.findByLabelText("Date de naissance"), "1996-11-04");
    await user.type(screen.getByRole("textbox", { name: "Protéines (g)" }), "900");
    await user.click(screen.getByRole("button", { name: "Activer mes objectifs" }));

    expect(screen.getByText("Choisissez une formule de calcul.")).toBeVisible();
    const radio = screen.getByRole("radio", { name: "Formule masculine" });
    expect(radio).toHaveFocus();
    expect(radio).toHaveAccessibleDescription(/Choisissez une formule de calcul\.$/);
    expect(screen.getByRole("textbox", { name: "Protéines (g)" })).toHaveAccessibleDescription(
      "Nombre entier de 0 à 500.",
    );
    expect(sent()).toBeUndefined();
  });

  it("explique qu'une pesée manque pour calculer", async () => {
    targetsApi({
      configured: true,
      inputs: INPUTS,
      computed: null,
      targets: null,
      missing: ["weight"],
    });
    renderWithQuery(<NutritionTargets />);

    expect(await screen.findByText(/^Pour calculer, notez une première pesée/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Corps" })).toHaveAttribute("href", "/corps");
  });
});

describe("NutritionTargets, refus et manques", () => {
  it("refuse une date de naissance hors de l'âge accepté", async () => {
    const sent = targetsApi(NOT_CONFIGURED);
    const user = userEvent.setup();
    renderWithQuery(<NutritionTargets />);

    await user.click(await screen.findByText("Formule féminine"));
    await user.type(screen.getByLabelText("Date de naissance"), "2024-01-01");
    await user.click(screen.getByRole("button", { name: "Activer mes objectifs" }));

    const birth = screen.getByLabelText("Date de naissance");
    expect(birth).toHaveFocus();
    expect(birth).toHaveAccessibleDescription(/^Date de naissance du .* au .*\.$/);
    expect(sent()).toBeUndefined();
  });

  it("rattache un refus de l'API au champ désigné", async () => {
    targetsApi(NOT_CONFIGURED);
    server.use(
      http.put("*/api/v1/nutrition/targets/", () =>
        HttpResponse.json(
          { status: 422, errors: [{ loc: ["birth_date"], type: "out_of_range" }] },
          { status: 422, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithQuery(<NutritionTargets />);

    await user.click(await screen.findByText("Formule masculine"));
    await user.type(screen.getByLabelText("Date de naissance"), "1996-11-04");
    await user.click(screen.getByRole("button", { name: "Activer mes objectifs" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Date de naissance")).toHaveFocus();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Objectifs non enregistrés.");
  });

  it("annonce à l'enregistrement qu'une pesée manque", async () => {
    server.use(
      http.get("*/api/v1/nutrition/targets/", () => HttpResponse.json(NOT_CONFIGURED)),
      http.put("*/api/v1/nutrition/targets/", async ({ request }) =>
        HttpResponse.json({
          configured: true,
          inputs: await request.json(),
          computed: null,
          targets: null,
          missing: ["weight"],
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithQuery(<NutritionTargets />);

    await user.click(await screen.findByText("Formule masculine"));
    await user.type(screen.getByLabelText("Date de naissance"), "1996-11-04");
    await user.click(screen.getByRole("button", { name: "Activer mes objectifs" }));

    expect(
      await screen.findByText(
        "Objectifs enregistrés. Pour les calculer, notez une première pesée dans Corps.",
      ),
    ).toBeVisible();
  });
});

describe("FoodJournal avec objectifs", () => {
  it("affiche les totaux en regard des objectifs", async () => {
    targetsApi({
      configured: true,
      inputs: INPUTS,
      computed: COMPUTED,
      targets: COMPUTED,
      missing: [],
    });
    server.use(
      http.get("*/api/v1/journal/:day/", ({ params }) =>
        HttpResponse.json({
          date: params.day,
          entries: [],
          totals: { kcal: 1360, protein: 72, carbs: 176.2, fat: 36.1 },
          water_ml: 0,
        }),
      ),
    );
    renderWithQuery(<FoodJournal />);

    expect(await screen.findByText(/^sur 3\s030\skcal, reste 1\s670\skcal$/)).toBeVisible();
    expect(screen.getByText(/^sur 160\sg$/)).toBeVisible();
  });
});
