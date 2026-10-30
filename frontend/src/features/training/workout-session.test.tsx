import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { FINISHED, NOT_SAVED, WORKOUT_UNAVAILABLE, WorkoutSession } from "./workout-session";

const WORKOUT_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const STARTED = "2026-10-30T17:05:00Z";
const BENCH = "8c5b0f4e-9b1a-4d43-9d55-0d6d6b1f1a01";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ongoing = { id: WORKOUT_ID, started_at: STARTED, ended_at: null };

function detail(exercises: object[] = []) {
  return { ...ongoing, volume_kg: 0, exercises };
}

const benchItem = {
  id: "2b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  workout_id: WORKOUT_ID,
  exercise_id: BENCH,
  position: 0,
  exercise_name: "Développé couché",
  exercise_name_language: "fr",
  sets: [],
};

function api({
  current = null as object | null,
  exercises = [] as object[],
}: { current?: object | null; exercises?: object[] } = {}) {
  server.use(
    http.get("*/api/v1/workouts/", () =>
      HttpResponse.json({ items: current ? [current] : [], next_cursor: null }),
    ),
    http.get(`*/api/v1/workouts/${WORKOUT_ID}/`, () => HttpResponse.json(detail(exercises))),
    http.get("*/api/v1/exercises/", () =>
      HttpResponse.json({
        items: [
          {
            id: BENCH,
            name: "Développé couché",
            name_language: "fr",
            category: "chest",
            muscles: [],
            equipment: [],
          },
        ],
        next_cursor: null,
      }),
    ),
    http.get("*/api/v1/exercise-filters/", () =>
      HttpResponse.json({ categories: [], muscles: [], equipment: [] }),
    ),
  );
}

describe("WorkoutSession", () => {
  it("démarre une séance avec un identifiant v4 généré par le client", async () => {
    api();
    let path = "";
    let body: unknown;
    server.use(
      http.put("*/api/v1/workouts/:id/", async ({ request, params }) => {
        path = String(params.id);
        body = await request.json();
        return HttpResponse.json(ongoing, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<WorkoutSession />);

    await user.click(await screen.findByRole("button", { name: "Démarrer une séance" }));

    expect(await screen.findByText("Ajoutez un premier exercice pour commencer.")).toBeVisible();
    expect(path).toMatch(UUID_V4);
    expect(body).toEqual({ started_at: expect.any(String) as string });
  });

  it("reprend la séance en cours et ajoute un exercice à la suite", async () => {
    api({ current: ongoing, exercises: [benchItem] });
    let body: unknown;
    server.use(
      http.put("*/api/v1/workout-exercises/:id/", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...benchItem, position: 1 }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<WorkoutSession />);

    const list = await screen.findByRole("list", { name: "Exercices de la séance" });
    expect(within(list).getByRole("listitem")).toHaveTextContent("Développé couchéAucune série");
    await user.click(screen.getByRole("button", { name: "Ajouter un exercice" }));
    await user.click(await screen.findByRole("button", { name: /Développé couché/ }));

    await waitFor(() => {
      expect(body).toEqual({ workout_id: WORKOUT_ID, exercise_id: BENCH, position: 1 });
    });
    expect(await screen.findByRole("button", { name: "Terminer la séance" })).toBeVisible();
  });

  it("garde le choix ouvert et l'annonce si l'ajout échoue", async () => {
    api({ current: ongoing });
    server.use(
      http.put("*/api/v1/workout-exercises/:id/", () => new HttpResponse(null, { status: 503 })),
    );
    const user = userEvent.setup();
    renderWithQuery(<WorkoutSession />);

    await user.click(await screen.findByRole("button", { name: "Ajouter un exercice" }));
    await user.click(await screen.findByRole("button", { name: /Développé couché/ }));

    expect(await screen.findByText(NOT_SAVED)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Ajouter un exercice" })).toBeVisible();
  });

  it("termine la séance après confirmation", async () => {
    api({ current: ongoing });
    let body: unknown;
    server.use(
      http.put(`*/api/v1/workouts/${WORKOUT_ID}/`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...ongoing, ended_at: "2026-10-30T18:00:00Z" });
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<WorkoutSession />);

    await user.click(await screen.findByRole("button", { name: "Terminer la séance" }));
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(body).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "Terminer la séance" }));
    await user.click(screen.getByRole("button", { name: "Terminer" }));

    expect(await screen.findByText(FINISHED)).toBeVisible();
    expect(body).toEqual({ started_at: STARTED, ended_at: expect.any(String) as string });
    expect(screen.getByRole("button", { name: "Démarrer une séance" })).toBeVisible();
  });

  it("annonce une panne et permet de réessayer", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/v1/workouts/", () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json({ items: [], next_cursor: null });
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<WorkoutSession />);

    expect(await screen.findByText(WORKOUT_UNAVAILABLE)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(await screen.findByRole("button", { name: "Démarrer une séance" })).toBeVisible();
  });
});
