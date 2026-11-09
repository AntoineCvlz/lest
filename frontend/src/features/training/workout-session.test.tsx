import { onlineManager } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { copiedExerciseId } from "./pending-workouts";
import { ADD_REFUSED } from "./use-workout";
import { FINISHED, FINISHED_OFFLINE, WORKOUT_UNAVAILABLE, WorkoutSession } from "./workout-session";

const WORKOUT_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const STARTED = "2026-10-30T17:05:00Z";
const BENCH = "8c5b0f4e-9b1a-4d43-9d55-0d6d6b1f1a01";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACCOUNT = "9b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const DAY_ID = "4b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const PLANNED_ID = "6b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

interface Workout {
  id: string;
  started_at: string;
  ended_at: string | null;
  program_day_id?: string | null;
}

const ongoing: Workout = { id: WORKOUT_ID, started_at: STARTED, ended_at: null };

const benchItem = {
  id: "2b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  workout_id: WORKOUT_ID,
  exercise_id: BENCH,
  position: 0,
  exercise_name: "Développé couché",
  exercise_name_language: "fr",
  exercise_category: "chest",
  exercise_image: null,
  target_sets: null as number | null,
  target_reps: null as number | null,
  sets: [],
};

const pushDay = {
  id: DAY_ID,
  program_id: "p",
  name: "Poussée",
  position: 0,
  exercises: [
    {
      id: PLANNED_ID,
      day_id: DAY_ID,
      exercise_id: BENCH,
      exercise_name: "Développé couché",
      exercise_name_language: "fr",
      exercise_category: "chest",
      exercise_image: null,
      position: 0,
      target_sets: 3,
      target_reps: 8,
    },
  ],
};

/**
 * Faux serveur qui garde son état : les écritures changent ce que relit l'écran, comme l'API
 * (une séance type est recopiée à la création, une séance terminée n'est plus en cours).
 */
function api({
  current = null as Workout | null,
  exercises = [] as (typeof benchItem)[],
  programs = [] as object[],
} = {}) {
  const state = { current, exercises: [...exercises], writes: [] as unknown[] };
  server.use(
    http.get("*/api/v1/workouts/", () =>
      HttpResponse.json({ items: state.current ? [state.current] : [], next_cursor: null }),
    ),
    http.get("*/api/v1/workouts/:id/", ({ params }) =>
      state.current?.id === params.id
        ? HttpResponse.json({ ...state.current, volume_kg: 0, exercises: state.exercises })
        : new HttpResponse(null, { status: 404 }),
    ),
    http.put("*/api/v1/workouts/:id/", async ({ request, params }) => {
      const id = String(params.id);
      const body = (await request.json()) as Omit<Workout, "id">;
      state.writes.push({ id, ...body });
      if (body.ended_at) {
        state.current = null;
      } else if (state.current?.id !== id) {
        state.current = { id, ...body };
        if (body.program_day_id === DAY_ID) {
          state.exercises = [
            {
              ...benchItem,
              id: await copiedExerciseId(id, PLANNED_ID),
              workout_id: id,
              target_sets: 3,
              target_reps: 8,
            },
          ];
        }
      }
      return HttpResponse.json({ id, ...body }, { status: 201 });
    }),
    http.put("*/api/v1/workout-exercises/:id/", async ({ request, params }) => {
      const id = String(params.id);
      const body = (await request.json()) as { position: number };
      state.writes.push({ id, ...body });
      state.exercises.push({ ...benchItem, id, position: body.position });
      return HttpResponse.json({ id, ...body }, { status: 201 });
    }),
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
    http.get("*/api/v1/me/profile/", () => new HttpResponse(null, { status: 404 })),
    http.get("*/api/v1/me/", () => HttpResponse.json({ id: ACCOUNT, email: "a@example.com" })),
    http.get("*/api/v1/programs/", () => HttpResponse.json(programs)),
    http.get("*/api/v1/exercises/:id/last-sets/", () => HttpResponse.json({ sets: [] })),
  );
  return state;
}

describe("WorkoutSession", () => {
  it("démarre une séance avec un identifiant v4 généré par le client", async () => {
    const state = api();
    const user = userEvent.setup();
    renderWithQuery(<WorkoutSession />);

    await user.click(await screen.findByRole("button", { name: "Démarrer une séance" }));

    expect(await screen.findByText("Ajoutez un premier exercice pour commencer.")).toBeVisible();
    await waitFor(() => {
      expect(state.writes).toEqual([
        {
          id: expect.stringMatching(UUID_V4) as string,
          started_at: expect.any(String) as string,
          ended_at: null,
        },
      ]);
    });
    expect(screen.getByText("Ajoutez un premier exercice pour commencer.")).toBeVisible();
  });

  it("démarre une séance type avec ses exercices affichés tout de suite", async () => {
    const state = api({
      programs: [{ id: "5b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", name: "PPL", days: [pushDay] }],
    });
    const user = userEvent.setup();
    renderWithQuery(<WorkoutSession />);

    await user.click(await screen.findByRole("button", { name: "Démarrer Poussée (PPL)" }));

    const list = await screen.findByRole("list", { name: "Exercices de la séance" });
    expect(list).toHaveTextContent("Développé couché0 sur 3 séries, cible 3 × 8");
    await waitFor(() => {
      expect(state.writes).toEqual([
        {
          id: expect.stringMatching(UUID_V4) as string,
          started_at: expect.any(String) as string,
          ended_at: null,
          program_day_id: DAY_ID,
        },
      ]);
    });
    // Relue sur le serveur : la même ligne, sous l'identifiant dérivé par l'API.
    await user.click(within(list).getByRole("button", { name: /Développé couché/ }));
    expect(await screen.findByRole("heading", { name: "Développé couché" })).toBeVisible();
  });

  it("invite à créer un programme quand il n'y a aucune séance type", async () => {
    api();
    renderWithQuery(<WorkoutSession />);

    expect(
      await screen.findByText(
        "Aucune séance type pour l’instant : créez un programme pour démarrer en un appui.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Mes programmes" })).toHaveAttribute(
      "href",
      "/seance/programmes",
    );
  });

  it("reprend la séance en cours et ajoute un exercice à la suite, puis ouvre sa saisie", async () => {
    const state = api({ current: ongoing, exercises: [benchItem] });
    const user = userEvent.setup();
    renderWithQuery(<WorkoutSession />);

    const list = await screen.findByRole("list", { name: "Exercices de la séance" });
    expect(within(list).getByRole("listitem")).toHaveTextContent("Développé couchéAucune série");
    await user.click(screen.getByRole("button", { name: "Ajouter un exercice" }));
    await user.click(await screen.findByRole("button", { name: /Développé couché/ }));

    expect(await screen.findByRole("heading", { name: "Développé couché" })).toBeVisible();
    await waitFor(() => {
      expect(state.writes).toEqual([
        {
          id: expect.stringMatching(UUID_V4) as string,
          workout_id: WORKOUT_ID,
          exercise_id: BENCH,
          position: 1,
        },
      ]);
    });
    await user.click(screen.getByRole("button", { name: "Retour à la séance" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("annonce un exercice refusé par le serveur et le retire de la séance", async () => {
    api({ current: ongoing });
    server.use(
      http.put("*/api/v1/workout-exercises/:id/", () => new HttpResponse(null, { status: 422 })),
    );
    const user = userEvent.setup();
    renderWithQuery(<WorkoutSession />);

    await user.click(await screen.findByRole("button", { name: "Ajouter un exercice" }));
    await user.click(await screen.findByRole("button", { name: /Développé couché/ }));

    expect(await screen.findByText(ADD_REFUSED)).toBeVisible();
    expect(await screen.findByText("Ajoutez un premier exercice pour commencer.")).toBeVisible();
  });

  it("démarre puis termine une séance hors ligne, envoyées dans l'ordre au retour du réseau", async () => {
    const state = api();
    const user = userEvent.setup();
    const { queryClient } = renderWithQuery(<WorkoutSession />);
    const start = await screen.findByRole("button", { name: "Démarrer une séance" });
    await waitFor(() => {
      expect(
        queryClient.getQueriesData({ queryKey: ["get", "/api/v1/me/"] })[0]?.[1],
      ).toBeDefined();
    });

    onlineManager.setOnline(false);
    try {
      await user.click(start);
      expect(await screen.findByText("Ajoutez un premier exercice pour commencer.")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Terminer la séance" }));
      await user.click(screen.getByRole("button", { name: "Terminer" }));

      expect(await screen.findByText(FINISHED_OFFLINE)).toBeVisible();
      expect(
        screen.getByText("2 saisies en attente d’envoi, gardées sur cet appareil."),
      ).toBeVisible();
      expect(state.writes).toEqual([]);
    } finally {
      onlineManager.setOnline(true);
    }

    await waitFor(() => {
      expect(state.writes).toEqual([
        expect.objectContaining({ ended_at: null }),
        expect.objectContaining({ ended_at: expect.any(String) as string }),
      ]);
    });
    await waitFor(() => {
      expect(screen.queryByText(/en attente d’envoi/)).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Démarrer une séance" })).toBeVisible();
  });

  it("termine la séance après confirmation", async () => {
    const state = api({ current: ongoing });
    const user = userEvent.setup();
    renderWithQuery(<WorkoutSession />);

    await user.click(await screen.findByRole("button", { name: "Terminer la séance" }));
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(state.writes).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Terminer la séance" }));
    await user.click(screen.getByRole("button", { name: "Terminer" }));

    expect(await screen.findByText(FINISHED)).toBeVisible();
    await waitFor(() => {
      expect(state.writes).toEqual([
        { id: WORKOUT_ID, started_at: STARTED, ended_at: expect.any(String) as string },
      ]);
    });
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
