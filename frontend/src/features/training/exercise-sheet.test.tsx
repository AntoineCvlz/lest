import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { EXERCISE_NOT_FOUND, ExerciseSheet, NO_RECORDS } from "./exercise-sheet";

const ID = "8c5b0f4e-9b1a-4d43-9d55-0d6d6b1f1a01";

const sheet = {
  id: ID,
  name: "Bench press",
  name_language: "en",
  category: "chest",
  muscles: [{ id: 4, name: "Grand pectoral" }],
  secondary_muscles: [{ id: 5, name: "Triceps" }],
  equipment: [{ id: 1, name: "Barre" }],
  license: "RepDB free tier v1.0",
  license_author: "RepDB",
  is_active: true,
  image: null,
  images: [] as object[],
};

function record(kind: "weight" | "e1rm", value_kg: number, day: number) {
  return { kind, value_kg, achieved_at: `2026-10-${String(day).padStart(2, "0")}T18:00:00Z` };
}

function api({ history = [] as object[], unit_system = "metric" } = {}) {
  server.use(
    http.get(`*/api/v1/exercises/${ID}/`, () => HttpResponse.json(sheet)),
    http.get(`*/api/v1/exercises/${ID}/records/`, () => HttpResponse.json({ history })),
    http.get("*/api/v1/me/profile/", () =>
      HttpResponse.json({
        goal: "gain",
        unit_system,
        height_m: 1.8,
        one_rm_formula: "epley",
        onboarded_at: "2026-10-01T00:00:00Z",
      }),
    ),
  );
}

describe("ExerciseSheet", () => {
  it("décrit l'exercice et crédite sa source", async () => {
    api();
    renderWithQuery(<ExerciseSheet id={ID} />);

    const title = await screen.findByRole("heading", { level: 1, name: "Bench press" });
    expect(title).toHaveAttribute("lang", "en");
    expect(screen.getByText("Grand pectoral")).toBeVisible();
    expect(screen.getByText("Triceps")).toBeVisible();
    // Mention et lien exigés par la licence RepDB (ADR 0006).
    expect(screen.getByRole("link", { name: "Exercise data by RepDB (repdb.co)" })).toHaveAttribute(
      "href",
      "https://repdb.co",
    );
    expect(screen.getByRole("link", { name: "Sources et licences" })).toHaveAttribute(
      "href",
      "/sources",
    );
    expect(await screen.findByText(NO_RECORDS)).toBeVisible();
  });

  it("montre les meilleurs records et la progression, la plus récente d'abord", async () => {
    api({
      history: [
        record("weight", 80, 1),
        record("e1rm", 96, 1),
        record("weight", 85, 8),
        record("e1rm", 99.17, 15),
      ],
    });
    renderWithQuery(<ExerciseSheet id={ID} />);

    const table = await screen.findByRole("table", { name: /Progression/ });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      "15 octobre 20261RM estimé99,17 kg",
      "8 octobre 2026Charge max85 kg",
      "1 octobre 20261RM estimé96 kg",
      "1 octobre 2026Charge max80 kg",
    ]);
    // Meilleurs records actuels : le dernier de chaque type.
    const bests = within(screen.getByRole("region", { name: "Vos records" }))
      .getAllByRole("term")
      .map((term) => term.parentElement?.textContent);
    expect(bests).toEqual(["Charge max85 kg8 octobre 2026", "1RM estimé99,17 kg15 octobre 2026"]);
  });

  it("affiche les records en livres pour un profil impérial", async () => {
    api({ history: [record("weight", 102.06, 1)], unit_system: "imperial" });
    renderWithQuery(<ExerciseSheet id={ID} />);

    expect((await screen.findAllByText("225 lb")).length).toBeGreaterThan(0);
  });

  it("replie un long historique", async () => {
    api({
      history: Array.from({ length: 12 }, (_, index) => record("weight", 60 + index, index + 1)),
    });
    const user = userEvent.setup();
    renderWithQuery(<ExerciseSheet id={ID} />);

    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(11);
    await user.click(screen.getByRole("button", { name: "Afficher les 12 records" }));
    expect(within(table).getAllByRole("row")).toHaveLength(13);
  });

  it("montre le mouvement : départ puis effort, en alternance", async () => {
    const start = {
      url: `/api/v1/exercise-images/${"b".repeat(64)}.webp`,
      license: "RepDB free tier v1.0",
      license_author: "RepDB",
    };
    const peak = { ...start, url: `/api/v1/exercise-images/${"c".repeat(64)}.webp` };
    server.use(
      http.get(`*/api/v1/exercises/${ID}/`, () =>
        HttpResponse.json({ ...sheet, image: start, images: [start, peak] }),
      ),
      http.get(`*/api/v1/exercises/${ID}/records/`, () => HttpResponse.json({ history: [] })),
      http.get("*/api/v1/me/profile/", () => new HttpResponse(null, { status: 404 })),
    );
    renderWithQuery(<ExerciseSheet id={ID} />);

    expect(
      await screen.findByRole("img", {
        name: "Illustration de l’exercice Bench press, position de départ et position d’effort",
      }),
    ).toHaveAttribute("src", start.url);
    // Image d'effort : décorative, animée par CSS et masquée si le mouvement est réduit.
    const effort = document.querySelector(`img[src="${peak.url}"]`);
    expect(effort).toHaveAttribute("alt", "");
    expect(effort?.parentElement).toHaveClass("animate-pose", "motion-reduce:hidden");
  });

  it("signale un exercice inconnu", async () => {
    server.use(
      http.get(`*/api/v1/exercises/${ID}/`, () => new HttpResponse(null, { status: 404 })),
      http.get("*/api/v1/me/profile/", () => new HttpResponse(null, { status: 404 })),
    );
    renderWithQuery(<ExerciseSheet id={ID} />);

    expect(await screen.findByText(EXERCISE_NOT_FOUND)).toBeVisible();
    expect(screen.getByRole("link", { name: "Revenir aux exercices" })).toBeVisible();
  });
});
