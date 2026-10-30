import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { CATALOG_UNAVAILABLE, ExerciseLibrary, NO_MATCH } from "./exercise-library";

const LIST_URL = "*/api/v1/exercises/";
const FILTERS_URL = "*/api/v1/exercise-filters/";

function exercise(id: string, name: string, overrides: object = {}) {
  return {
    id,
    name,
    name_language: "fr",
    category: "chest",
    muscles: [{ id: 4, name: "Pectoralis major" }],
    equipment: [{ id: 1, name: "Barre" }],
    ...overrides,
  };
}

const bench = exercise("8c5b0f4e-9b1a-4d43-9d55-0d6d6b1f1a01", "Développé couché");
const squat = exercise("8c5b0f4e-9b1a-4d43-9d55-0d6d6b1f1a02", "Squat", {
  category: "legs",
  muscles: [],
  equipment: [],
});
const englishOnly = exercise("8c5b0f4e-9b1a-4d43-9d55-0d6d6b1f1a03", "Cable crossover", {
  name_language: "en",
});

/** Requêtes reçues par l'API simulée : paramètres de chaque recherche. */
function catalog(pages: Record<string, { items: object[]; next_cursor: string | null }>) {
  const seen: URLSearchParams[] = [];
  server.use(
    http.get(LIST_URL, ({ request }) => {
      const params = new URL(request.url).searchParams;
      seen.push(params);
      const page = pages[params.get("cursor") ?? ""] ?? { items: [], next_cursor: null };
      return HttpResponse.json(page);
    }),
    http.get(FILTERS_URL, () =>
      HttpResponse.json({
        categories: ["chest", "legs"],
        muscles: [{ id: 4, name: "Pectoralis major" }],
        equipment: [{ id: 1, name: "Barre" }],
      }),
    ),
  );
  return seen;
}

describe("ExerciseLibrary", () => {
  it("liste les exercices avec leur catégorie, muscles et équipement", async () => {
    const seen = catalog({ "": { items: [bench, englishOnly], next_cursor: null } });
    renderWithQuery(<ExerciseLibrary />);

    const items = within(await screen.findByRole("list", { name: "Exercices" })).getAllByRole(
      "listitem",
    );

    expect(items[0]).toHaveTextContent("Développé couché");
    expect(items[0]).toHaveTextContent("Pectoraux, Pectoralis major, Barre");
    expect(screen.getByRole("status")).toHaveTextContent("2 exercices affichés.");
    // Filtres vides : absents de la requête (et non « null »).
    expect([...(seen[0]?.keys() ?? [])].sort()).toEqual(["limit", "q"]);
    // Nom anglais affiché tel quel, mais prononcé en anglais par les lecteurs d'écran.
    expect(screen.getByText("Cable crossover")).toHaveAttribute("lang", "en");
  });

  it("cherche après une pause de frappe et combine les filtres", async () => {
    const seen = catalog({ "": { items: [bench], next_cursor: null } });
    const user = userEvent.setup();
    renderWithQuery(<ExerciseLibrary />);
    await screen.findByRole("list", { name: "Exercices" });

    await user.type(screen.getByRole("searchbox", { name: "Rechercher un exercice" }), "couche");
    await user.click(screen.getByText("Filtres"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Catégorie" }), "Pectoraux");
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Muscle" })).toBeEnabled();
    });
    await user.selectOptions(screen.getByRole("combobox", { name: "Muscle" }), "Pectoralis major");
    await user.selectOptions(screen.getByRole("combobox", { name: "Équipement" }), "Barre");
    expect(screen.getByText("Filtres (3 actifs)")).toBeInTheDocument();

    await waitFor(() => {
      const last = seen.at(-1);
      expect(last?.get("q")).toBe("couche");
      expect(last?.get("category")).toBe("chest");
      expect(last?.get("muscle")).toBe("4");
      expect(last?.get("equipment")).toBe("1");
    });
    // Une requête par pause de frappe, pas une par lettre.
    expect(seen.filter((params) => params.get("q") === "c")).toHaveLength(0);
  });

  it("affiche la page suivante à la demande", async () => {
    catalog({
      "": { items: [bench], next_cursor: "page-2" },
      "page-2": { items: [squat], next_cursor: null },
    });
    const user = userEvent.setup();
    renderWithQuery(<ExerciseLibrary />);

    await screen.findByText("1 exercice affiché, d’autres suivent.");
    await user.click(screen.getByRole("button", { name: "Afficher plus d’exercices" }));

    expect(await screen.findByText("Squat")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 exercices affichés.");
    expect(screen.queryByRole("button", { name: "Afficher plus d’exercices" })).toBeNull();
  });

  it("propose d'effacer les filtres quand rien ne correspond", async () => {
    const seen = catalog({ "": { items: [], next_cursor: null } });
    const user = userEvent.setup();
    renderWithQuery(<ExerciseLibrary />);
    await user.click(screen.getByText("Filtres"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Catégorie" }), "Mollets");

    expect(await screen.findByText(NO_MATCH)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Effacer la recherche et les filtres" }));

    expect(screen.getByRole("combobox", { name: "Catégorie" })).toHaveValue("");
    expect(seen.at(-1)?.get("category")).toBe("calves");
    // Retour à la recherche initiale : servie par le cache, bouton retiré.
    expect(screen.queryByRole("button", { name: /Effacer/ })).toBeNull();
  });

  it("annonce une panne et permet de réessayer", async () => {
    let calls = 0;
    server.use(
      http.get(LIST_URL, () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json({ items: [squat], next_cursor: null });
      }),
      http.get(FILTERS_URL, () => new HttpResponse(null, { status: 503 })),
    );
    const user = userEvent.setup();
    renderWithQuery(<ExerciseLibrary />);

    expect(await screen.findByText(CATALOG_UNAVAILABLE)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(CATALOG_UNAVAILABLE);
    expect(screen.getByRole("combobox", { name: "Muscle" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(await screen.findByText("Squat")).toBeInTheDocument();
  });
});
