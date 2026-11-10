import { onlineManager } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { localDay, shiftDay } from "@/shared/lib/days";
import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { FoodJournal, JOURNAL_UNAVAILABLE } from "./food-journal";
import { barcodeError } from "./food-picker";
import { NutritionRequestFailed } from "./use-nutrition";

const TODAY = localDay();
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const RICE = {
  id: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  source: "ciqual",
  name: "Riz témoin, cuit",
  brand: "",
  kcal_100g: 150,
  protein_100g: 3,
  carbs_100g: 32,
  fat_100g: null,
  serving_g: null,
  is_custom: false,
  source_url: null,
};
const BAR = {
  ...RICE,
  id: "2b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  name: "Barre témoin",
  brand: "Marque",
  serving_g: 40,
  source: "off",
  source_url: "https://world.openfoodfacts.org/product/3017620422003",
};
const ENTRY = {
  id: "3b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  date: TODAY,
  meal: "lunch",
  food_id: RICE.id,
  name: "Riz témoin, cuit",
  grams: 200,
  kcal: 300,
  protein: 6,
  carbs: 64,
  fat: 0,
};

function day(entries: object[] = [ENTRY], water_ml = 500) {
  return {
    date: TODAY,
    entries,
    totals: { kcal: 300, protein: 6, carbs: 64, fat: 0 },
    water_ml,
  };
}

function api({ journal = day(), recent = [RICE] as object[] } = {}) {
  const seen: string[] = [];
  server.use(
    http.get("*/api/v1/journal/:day/", ({ params }) => {
      seen.push(String(params.day));
      return HttpResponse.json({ ...journal, date: params.day });
    }),
    http.get("*/api/v1/foods/recent/", () => HttpResponse.json(recent)),
    http.get("*/api/v1/me/", () =>
      HttpResponse.json({ id: "9b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", email: "a@example.com" }),
    ),
    http.get("*/api/v1/foods/", ({ request }) =>
      HttpResponse.json(new URL(request.url).searchParams.get("q") === "barre" ? [BAR] : []),
    ),
  );
  return seen;
}

describe("barcodeError", () => {
  it("explique chaque réponse du scan", () => {
    expect(barcodeError(new NutritionRequestFailed(404))).toMatch(/^Code-barres inconnu/);
    expect(barcodeError(new NutritionRequestFailed(422))).toMatch(/^Produit sans valeurs/);
    expect(barcodeError(new NutritionRequestFailed(429))).toMatch(/^Trop de produits/);
    expect(barcodeError(new NutritionRequestFailed(503))).toMatch(/indisponible/);
  });
});

describe("FoodJournal", () => {
  it("affiche les totaux et les repas du jour", async () => {
    api();
    renderWithQuery(<FoodJournal />);

    expect(await screen.findByText("300 kcal", { selector: "dd" })).toBeVisible();
    const lunch = screen.getByRole("list", { name: "Déjeuner" });
    expect(
      within(lunch).getByRole("button", { name: /^Modifier Riz témoin, cuit, 200/ }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Aujourd’hui" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Jour suivant" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("ajoute un aliment récent au repas, sous un UUID v4, et rend le focus", async () => {
    api({ journal: day([]) });
    let body: unknown;
    let path = "";
    server.use(
      http.put("*/api/v1/journal-entries/:id/", async ({ request, params }) => {
        path = String(params.id);
        body = await request.json();
        return HttpResponse.json({ ...ENTRY, id: path }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<FoodJournal />);

    await user.click(await screen.findByRole("button", { name: "Ajouter au dîner" }));
    expect(screen.getByRole("searchbox", { name: "Rechercher un aliment" })).toHaveFocus();
    await user.click(await screen.findByRole("button", { name: /^Riz témoin, cuit/ }));
    const quantity = screen.getByRole("textbox", { name: "Quantité (g)" });
    expect(quantity).toHaveFocus();
    expect(quantity).toHaveValue("100");
    await user.clear(quantity);
    await user.type(quantity, "180");
    await user.click(screen.getByRole("button", { name: "Ajouter au dîner" }));

    expect(await screen.findByText("Riz témoin, cuit ajouté au dîner.")).toBeVisible();
    expect(path).toMatch(UUID_V4);
    expect(body).toEqual({ date: TODAY, meal: "dinner", food_id: RICE.id, grams: 180 });
    expect(screen.getByRole("button", { name: "Ajouter au dîner" })).toHaveFocus();
  });

  it("ajoute un aliment hors ligne, l'affiche avec les totaux et l'envoie au retour du réseau", async () => {
    api({ journal: day([]) });
    const sent: unknown[] = [];
    server.use(
      http.put("*/api/v1/journal-entries/:id/", async ({ request, params }) => {
        sent.push(await request.json());
        return HttpResponse.json({ ...ENTRY, id: String(params.id) }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<FoodJournal />);
    await user.click(await screen.findByRole("button", { name: "Ajouter au dîner" }));
    await user.click(await screen.findByRole("button", { name: /^Riz témoin, cuit/ }));

    onlineManager.setOnline(false);
    try {
      await user.click(screen.getByRole("button", { name: "Ajouter au dîner" }));

      expect(
        await screen.findByText(
          "Riz témoin, cuit ajouté au dîner sur cet appareil, envoi au retour du réseau.",
        ),
      ).toBeVisible();
      expect(
        screen.getByText("1 saisie en attente d’envoi, gardée sur cet appareil."),
      ).toBeVisible();
      // 100 g à 150 kcal pour 100 g, avant la relecture du serveur.
      expect(
        within(screen.getByRole("list", { name: "Dîner" })).getByText("150 kcal"),
      ).toBeVisible();
      expect(sent).toEqual([]);
    } finally {
      onlineManager.setOnline(true);
    }

    await waitFor(() => {
      expect(sent).toEqual([{ date: TODAY, meal: "dinner", food_id: RICE.id, grams: 100 }]);
    });
  });

  it("cherche un aliment et propose sa portion", async () => {
    api({ journal: day([]) });
    const user = userEvent.setup();
    renderWithQuery(<FoodJournal />);

    await user.click(await screen.findByRole("button", { name: "Ajouter à la collation" }));
    await user.type(screen.getByRole("searchbox", { name: "Rechercher un aliment" }), "barre");
    await user.click(await screen.findByRole("button", { name: /^Barre témoin, Marque/ }));

    expect(screen.getByRole("textbox", { name: "Quantité (g)" })).toHaveValue("40");
    expect(screen.getByRole("textbox", { name: "Quantité (g)" })).toHaveAccessibleDescription(
      "60 kcal",
    );
  });

  it("propose aussitôt dans les récents l'aliment ajouté, même sans réseau", async () => {
    api({ journal: day([]), recent: [] });
    const user = userEvent.setup();
    renderWithQuery(<FoodJournal />);

    await user.click(await screen.findByRole("button", { name: "Ajouter à la collation" }));
    await user.type(screen.getByRole("searchbox", { name: "Rechercher un aliment" }), "barre");
    await user.click(await screen.findByRole("button", { name: /^Barre témoin, Marque/ }));
    onlineManager.setOnline(false);
    try {
      await user.click(screen.getByRole("button", { name: "Ajouter à la collation" }));
      await user.click(await screen.findByRole("button", { name: "Ajouter au dîner" }));

      expect(await screen.findByRole("button", { name: /^Barre témoin, Marque/ })).toBeVisible();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("annonce l'état de la recherche sans quitter le champ", async () => {
    api({ journal: day([]) });
    const user = userEvent.setup();
    renderWithQuery(<FoodJournal />);

    await user.click(await screen.findByRole("button", { name: "Ajouter à la collation" }));
    await user.type(screen.getByRole("searchbox", { name: "Rechercher un aliment" }), "barre");
    await waitFor(() => {
      expect(screen.getByText("1 aliment trouvé.")).toHaveAttribute("role", "status");
    });
    await user.clear(screen.getByRole("searchbox", { name: "Rechercher un aliment" }));
    await user.type(screen.getByRole("searchbox", { name: "Rechercher un aliment" }), "zzz");
    await waitFor(() => {
      expect(screen.getByText(/^Aucun aliment trouvé/)).toBeVisible();
    });
  });

  it("signale une quantité vide dans l'éditeur au lieu de ne rien faire", async () => {
    api();
    const user = userEvent.setup();
    renderWithQuery(<FoodJournal />);

    await user.click(await screen.findByRole("button", { name: /^Modifier Riz témoin, cuit/ }));
    const quantity = screen.getByRole("textbox", { name: "Quantité de Riz témoin, cuit (g)" });
    await user.clear(quantity);
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(screen.getByText("Saisissez une quantité entre 0 et 5 000 g.")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(quantity).toHaveFocus();
  });

  it("explique un code-barres inconnu sur son champ", async () => {
    api({ journal: day([]) });
    server.use(
      http.get("*/api/v1/foods/barcode/:code/", () =>
        HttpResponse.json({ status: 404 }, { status: 404 }),
      ),
    );
    const user = userEvent.setup();
    renderWithQuery(<FoodJournal />);

    await user.click(await screen.findByRole("button", { name: "Ajouter au petit-déjeuner" }));
    await user.type(screen.getByRole("textbox", { name: "Code-barres" }), "2000000000008");
    await user.click(screen.getByRole("button", { name: "Chercher le code-barres" }));

    expect(await screen.findByText(/^Code-barres inconnu/, { selector: "p" })).toBeVisible();
  });

  it("corrige la quantité, puis retire l'aliment après confirmation", async () => {
    api();
    let body: unknown;
    let deleted = "";
    server.use(
      http.put("*/api/v1/journal-entries/:id/", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...ENTRY, grams: 250 });
      }),
      http.delete("*/api/v1/journal-entries/:id/", ({ params }) => {
        deleted = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<FoodJournal />);

    await user.click(await screen.findByRole("button", { name: /^Modifier Riz témoin, cuit/ }));
    const quantity = screen.getByRole("textbox", { name: "Quantité de Riz témoin, cuit (g)" });
    expect(quantity).toHaveFocus();
    await user.clear(quantity);
    await user.type(quantity, "250");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => {
      expect(body).toEqual({ date: TODAY, meal: "lunch", food_id: RICE.id, grams: 250 });
    });

    await user.click(await screen.findByRole("button", { name: /^Modifier Riz témoin, cuit/ }));
    await user.click(screen.getByRole("button", { name: "Retirer Riz témoin, cuit" }));
    expect(screen.getByRole("button", { name: "Garder" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Retirer" }));

    expect(await screen.findByText("Riz témoin, cuit retiré.")).toBeVisible();
    expect(deleted).toBe(ENTRY.id);
  });

  it("ajoute de l'eau par pas de 250 ml, sans perdre un appui rapide", async () => {
    api();
    const sent: number[] = [];
    // Le serveur garde le dernier total reçu : la relecture après l'envoi le renvoie.
    server.use(
      http.put("*/api/v1/water/:day/", async ({ request }) => {
        const { ml } = (await request.json()) as { ml: number };
        sent.push(ml);
        return HttpResponse.json({ date: TODAY, ml });
      }),
      http.get("*/api/v1/journal/:day/", ({ params }) =>
        HttpResponse.json({ ...day(), date: params.day, water_ml: sent.at(-1) ?? day().water_ml }),
      ),
    );
    const user = userEvent.setup();
    renderWithQuery(<FoodJournal />);

    const more = await screen.findByRole("button", { name: "+250 millilitres" });
    await user.click(more);
    await user.click(more);

    await waitFor(() => {
      expect(sent).toEqual([750, 1000]);
    });
  });

  it("navigue vers le jour précédent", async () => {
    const seen = api();
    const user = userEvent.setup();
    renderWithQuery(<FoodJournal />);

    await screen.findByRole("list", { name: "Déjeuner" });
    await user.click(screen.getByRole("button", { name: "Jour précédent" }));

    await waitFor(() => {
      expect(seen).toContain(shiftDay(TODAY, -1));
    });
    const next = screen.getByRole("button", { name: "Jour suivant" });
    expect(next).toHaveAttribute("aria-disabled", "false");
    // Revenir à aujourd'hui garde le focus sur le bouton (il n'est pas `disabled`).
    await user.click(next);
    expect(next).toHaveFocus();
    expect(next).toHaveAttribute("aria-disabled", "true");
  });

  it("annonce une panne et permet de réessayer", async () => {
    let calls = 0;
    api();
    server.use(
      http.get("*/api/v1/journal/:day/", () => {
        calls += 1;
        return calls === 1 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json(day());
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<FoodJournal />);

    expect(await screen.findByText(JOURNAL_UNAVAILABLE)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(await screen.findByRole("list", { name: "Déjeuner" })).toBeVisible();
  });
});
