import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import type { Schemas } from "@/shared/api/client";
import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { prefill, SET_NOT_DELETED, SET_NOT_SAVED, SetEntry } from "./set-entry";
import type { RestTimer } from "./use-rest-timer";
import { workoutKey } from "./use-workout";

const WORKOUT_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const ITEM_ID = "2b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const BENCH = "8c5b0f4e-9b1a-4d43-9d55-0d6d6b1f1a01";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function set(weight_kg: number, reps: number, overrides: Partial<Schemas["SetOut"]> = {}) {
  return {
    id: crypto.randomUUID(),
    workout_exercise_id: ITEM_ID,
    position: 0,
    weight_kg,
    reps,
    rpe: null,
    is_warmup: false,
    performed_at: "2026-10-23T18:00:00Z",
    records: [],
    ...overrides,
  };
}

function item(sets: Schemas["SetOut"][] = []): Schemas["WorkoutExerciseDetailOut"] {
  return {
    id: ITEM_ID,
    workout_id: WORKOUT_ID,
    exercise_id: BENCH,
    position: 0,
    exercise_name: "Développé couché",
    exercise_name_language: "fr",
    sets,
  };
}

function lastTime(sets: object[]) {
  server.use(http.get(`*/api/v1/exercises/${BENCH}/last-sets/`, () => HttpResponse.json({ sets })));
}

const timer: RestTimer = {
  remaining: null,
  duration: 120,
  finished: false,
  start: vi.fn(),
  adjust: vi.fn(),
  stop: vi.fn(),
};

/** Saisie rendue avec la séance en cache, comme depuis l'écran de séance. */
function renderEntry(current = item(), system: "metric" | "imperial" = "metric") {
  const workout = {
    id: WORKOUT_ID,
    started_at: "2026-10-30T17:00:00Z",
    ended_at: null,
    volume_kg: 0,
    exercises: [current],
  };
  server.use(http.get(`*/api/v1/workouts/${WORKOUT_ID}/`, () => HttpResponse.json(workout)));
  const result = renderWithQuery(
    <SetEntry
      workoutId={WORKOUT_ID}
      item={current}
      system={system}
      timer={timer}
      onClose={vi.fn()}
    />,
  );
  result.queryClient.setQueryData(workoutKey(WORKOUT_ID), workout);
  return result;
}

function valueOf(group: string): string {
  return within(screen.getByRole("group", { name: group })).getByRole("status").textContent;
}

describe("prefill", () => {
  it("reprend la dernière série de la séance, sinon la première série de travail de la fois d'avant", () => {
    const warmup = set(40, 10, { is_warmup: true });
    expect(prefill(item([set(85, 6)]), [set(80, 8)], "metric")).toEqual({ weight: 85, reps: 6 });
    expect(prefill(item(), [warmup, set(80, 8)], "metric")).toEqual({ weight: 80, reps: 8 });
    expect(prefill(item(), [], "metric")).toEqual({ weight: 20, reps: 8 });
    expect(prefill(item(), [], "imperial")).toEqual({ weight: 45, reps: 8 });
  });
});

describe("SetEntry", () => {
  it("pré-remplit avec la dernière fois et envoie la série en kilos", async () => {
    lastTime([set(80, 8), set(82.5, 6)]);
    let body: Record<string, unknown> = {};
    let path = "";
    server.use(
      http.put("*/api/v1/sets/:id/", async ({ request, params }) => {
        path = String(params.id);
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(set(82.5, 8), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderEntry();

    expect(await screen.findByText("La dernière fois : 80 kg × 8, 82,5 kg × 6.")).toBeVisible();
    expect(valueOf("Charge")).toContain("80");
    await user.click(screen.getByRole("button", { name: "+2,5 kilos" }));
    await user.click(screen.getByRole("radio", { name: "8,5" }));
    await user.click(screen.getByRole("button", { name: "Valider la série" }));

    await waitFor(() => {
      expect(body).toMatchObject({
        workout_exercise_id: ITEM_ID,
        position: 0,
        weight_kg: "82.50",
        reps: 8,
        rpe: 8.5,
        is_warmup: false,
      });
    });
    expect(path).toMatch(UUID_V4);
    expect(await screen.findByText("Série 1 enregistrée.")).toBeVisible();
    // Le repos démarre à la validation.
    expect(timer.start).toHaveBeenCalledOnce();
    // Le RPE est propre à chaque série : remis à zéro, la charge reste.
    expect(screen.getByRole("radio", { name: "8,5" })).not.toBeChecked();
    expect(valueOf("Charge")).toContain("82,5");
  });

  it("affiche et saisit en livres, stocke en kilos", async () => {
    lastTime([set(102.06, 5)]);
    let body: Record<string, unknown> = {};
    server.use(
      http.put("*/api/v1/sets/:id/", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(set(104.33, 5), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderEntry(item(), "imperial");

    expect(await screen.findByText("La dernière fois : 225 lb × 5.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "+5 livres" }));
    await user.click(screen.getByRole("button", { name: "Valider la série" }));

    await waitFor(() => {
      expect(body.weight_kg).toBe("104.33");
    });
  });

  it("annonce un nouveau record", async () => {
    lastTime([]);
    server.use(
      http.put("*/api/v1/sets/:id/", () =>
        HttpResponse.json(
          set(20, 8, {
            records: [
              { kind: "weight", value_kg: 20, achieved_at: "2026-10-30T17:10:00Z" },
              { kind: "e1rm", value_kg: 25.33, achieved_at: "2026-10-30T17:10:00Z" },
            ],
          }),
          { status: 201 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderEntry();

    expect(await screen.findByText("Première fois pour cet exercice.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Valider la série" }));

    expect(
      await screen.findByText(
        "Série 1 enregistrée. Nouveau record : charge max 20 kg, 1RM estimé 25,33 kg.",
      ),
    ).toBeVisible();
  });

  it("retire la série affichée et l'annonce si l'API la refuse", async () => {
    lastTime([]);
    server.use(http.put("*/api/v1/sets/:id/", () => new HttpResponse(null, { status: 503 })));
    const user = userEvent.setup();
    const { queryClient } = renderEntry();

    await screen.findByText("Première fois pour cet exercice.");
    await user.click(screen.getByRole("button", { name: "Valider la série" }));

    expect(await screen.findByText(SET_NOT_SAVED)).toBeVisible();
    const cached = queryClient.getQueryData<Schemas["WorkoutDetailOut"]>(workoutKey(WORKOUT_ID));
    expect(cached?.exercises[0]?.sets).toEqual([]);
  });

  it("marque une série d'échauffement", async () => {
    lastTime([]);
    let body: Record<string, unknown> = {};
    server.use(
      http.put("*/api/v1/sets/:id/", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(set(20, 8, { is_warmup: true }), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderEntry();

    await user.click(await screen.findByRole("checkbox", { name: "Série d’échauffement" }));
    await user.click(screen.getByRole("button", { name: "Valider la série" }));

    await waitFor(() => {
      expect(body.is_warmup).toBe(true);
    });
    expect(screen.getByRole("checkbox", { name: "Série d’échauffement" })).not.toBeChecked();
  });

  it("modifie une série en gardant son identifiant, sa place et son heure", async () => {
    lastTime([]);
    const first = set(80, 8, { rpe: 8, performed_at: "2026-10-30T17:05:00Z" });
    const second = set(80, 6, { position: 1 });
    let body: Record<string, unknown> = {};
    let path = "";
    server.use(
      http.put("*/api/v1/sets/:id/", async ({ request, params }) => {
        path = String(params.id);
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...first, reps: 9 });
      }),
    );
    const user = userEvent.setup();
    renderEntry(item([first, second]));

    await user.click(await screen.findByRole("button", { name: "Modifier la série 1" }));
    // Le formulaire reprend la série ; le focus va à son titre.
    expect(screen.getByRole("heading", { name: "Modifier la série 1" })).toHaveFocus();
    expect(valueOf("Répétitions")).toContain("8");
    expect(screen.getByRole("radio", { name: "8" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "+1 répétition" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer la série 1" }));

    await waitFor(() => {
      expect(body).toMatchObject({
        position: 0,
        reps: 9,
        rpe: 8,
        performed_at: "2026-10-30T17:05:00Z",
      });
    });
    expect(path).toBe(first.id);
    expect(await screen.findByText("Série 1 modifiée.")).toBeVisible();
    // Retour à la saisie d'une nouvelle série, focus sur le bouton de la série modifiée.
    expect(screen.getByRole("button", { name: "Valider la série" })).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Modifier la série 1" })).toHaveFocus();
    });
  });

  it("supprime une série après confirmation", async () => {
    lastTime([]);
    const first = set(80, 8);
    let deleted = "";
    server.use(
      http.delete("*/api/v1/sets/:id/", ({ params }) => {
        deleted = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    const { queryClient } = renderEntry(item([first]));

    await user.click(await screen.findByRole("button", { name: "Modifier la série 1" }));
    await user.click(screen.getByRole("button", { name: "Supprimer la série" }));
    await user.click(screen.getByRole("button", { name: "Garder" }));
    expect(deleted).toBe("");
    await user.click(screen.getByRole("button", { name: "Supprimer la série" }));
    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(await screen.findByText("Série 1 supprimée.")).toBeVisible();
    expect(deleted).toBe(first.id);
    const cached = queryClient.getQueryData<Schemas["WorkoutDetailOut"]>(workoutKey(WORKOUT_ID));
    expect(cached?.exercises[0]?.sets).toEqual([]);
  });

  it("rétablit la série si la suppression est refusée", async () => {
    lastTime([]);
    const first = set(80, 8);
    server.use(http.delete("*/api/v1/sets/:id/", () => new HttpResponse(null, { status: 503 })));
    const user = userEvent.setup();
    const { queryClient } = renderEntry(item([first]));

    await user.click(await screen.findByRole("button", { name: "Modifier la série 1" }));
    await user.click(screen.getByRole("button", { name: "Supprimer la série" }));
    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(await screen.findByText(SET_NOT_DELETED)).toBeVisible();
    const cached = queryClient.getQueryData<Schemas["WorkoutDetailOut"]>(workoutKey(WORKOUT_ID));
    expect(cached?.exercises[0]?.sets.map((one) => one.id)).toEqual([first.id]);
  });

  it("annule une modification sans rien envoyer ni lancer le repos", async () => {
    lastTime([]);
    const put = vi.fn();
    server.use(
      http.put("*/api/v1/sets/:id/", () => {
        put();
        return HttpResponse.json(set(80, 8));
      }),
    );
    const user = userEvent.setup();
    vi.mocked(timer.start).mockClear();
    renderEntry(item([set(80, 8)]));

    await user.click(await screen.findByRole("button", { name: "Modifier la série 1" }));
    await user.click(screen.getByRole("button", { name: "Annuler" }));

    expect(screen.getByRole("button", { name: "Valider la série" })).toBeVisible();
    expect(put).not.toHaveBeenCalled();
    expect(timer.start).not.toHaveBeenCalled();
  });
});
