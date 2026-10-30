import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { durationText, setLine } from "./format";
import { WORKOUT_NOT_FOUND, WorkoutDetail } from "./workout-detail";
import { HISTORY_UNAVAILABLE, NO_HISTORY, WorkoutHistory } from "./workout-history";

const ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

function summary(id: string, day: number, overrides: object = {}) {
  const started = `2026-10-${String(day).padStart(2, "0")}T17:00:00Z`;
  return {
    id,
    started_at: started,
    ended_at: `2026-10-${String(day).padStart(2, "0")}T18:05:00Z`,
    exercise_count: 3,
    working_set_count: 12,
    volume_kg: 4250,
    ...overrides,
  };
}

function set(position: number, overrides: object = {}) {
  return {
    id: `set-${String(position)}`,
    workout_exercise_id: "item",
    position,
    weight_kg: 80,
    reps: 8,
    rpe: null,
    is_warmup: false,
    performed_at: "2026-10-29T17:10:00Z",
    records: [],
    ...overrides,
  };
}

describe("format", () => {
  it("écrit les durées et les séries comme à l'écran", () => {
    expect(durationText("2026-10-29T17:00:00Z", "2026-10-29T17:45:00Z")).toBe("45 min");
    expect(durationText("2026-10-29T17:00:00Z", "2026-10-29T18:05:00Z")).toBe("1 h 05");
    expect(setLine(set(0, { rpe: 8.5, is_warmup: true }), 1, "metric")).toBe(
      "Série 1 : 80 kg × 8, RPE 8,5, échauffement",
    );
  });
});

describe("WorkoutHistory", () => {
  it("résume chaque séance terminée et mène à son détail", async () => {
    let query = "";
    server.use(
      http.get("*/api/v1/workouts/", ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json({
          items: [
            summary(ID, 29),
            summary("autre", 27, { exercise_count: 1, working_set_count: 1 }),
          ],
          next_cursor: null,
        });
      }),
    );
    renderWithQuery(<WorkoutHistory system="metric" />);

    const list = await screen.findByRole("list", { name: "Séances passées" });
    const [first, second] = within(list).getAllByRole("link");
    expect(first).toHaveTextContent("jeudi 29 octobre 2026");
    expect(first).toHaveTextContent("1 h 05, 3 exercices, 12 séries, 4 250 kg");
    expect(first).toHaveAttribute("href", `/seance/${ID}`);
    expect(second).toHaveTextContent("1 exercice, 1 série");
    expect(query).toContain("ongoing=false");
  });

  it("charge les séances plus anciennes à la demande", async () => {
    server.use(
      http.get("*/api/v1/workouts/", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        return HttpResponse.json(
          cursor === "page-2"
            ? { items: [summary("ancienne", 1)], next_cursor: null }
            : { items: [summary(ID, 29)], next_cursor: "page-2" },
        );
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<WorkoutHistory system="metric" />);

    await user.click(await screen.findByRole("button", { name: "Afficher plus de séances" }));

    expect(await screen.findByText("jeudi 1 octobre 2026")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Afficher plus de séances" })).toBeNull();
  });

  it("présente l'historique vide et la panne", async () => {
    server.use(
      http.get("*/api/v1/workouts/", () => HttpResponse.json({ items: [], next_cursor: null })),
    );
    const { unmount } = renderWithQuery(<WorkoutHistory system="metric" />);
    expect(await screen.findByText(NO_HISTORY)).toBeVisible();
    unmount();

    server.use(http.get("*/api/v1/workouts/", () => new HttpResponse(null, { status: 503 })));
    renderWithQuery(<WorkoutHistory system="metric" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(HISTORY_UNAVAILABLE);
  });
});

describe("WorkoutDetail", () => {
  it("détaille les exercices, les séries et les records, en lecture", async () => {
    server.use(
      http.get(`*/api/v1/workouts/${ID}/`, () =>
        HttpResponse.json({
          id: ID,
          started_at: "2026-10-29T17:00:00Z",
          ended_at: "2026-10-29T17:45:00Z",
          volume_kg: 1280,
          exercises: [
            {
              id: "item",
              workout_id: ID,
              exercise_id: "bench",
              position: 0,
              exercise_name: "Développé couché",
              exercise_name_language: "fr",
              sets: [
                set(0),
                set(1, {
                  records: [{ kind: "weight", value_kg: 80, achieved_at: "2026-10-29T17:12:00Z" }],
                }),
              ],
            },
          ],
        }),
      ),
      http.get("*/api/v1/me/profile/", () => new HttpResponse(null, { status: 404 })),
    );
    renderWithQuery(<WorkoutDetail id={ID} />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "jeudi 29 octobre 2026" }),
    ).toBeVisible();
    expect(screen.getByText("45 min, volume 1 280 kg")).toBeVisible();
    const exercise = screen.getByRole("region", { name: "Développé couché" });
    expect(within(exercise).getByRole("link", { name: "Développé couché" })).toHaveAttribute(
      "href",
      "/exercices/bench",
    );
    expect(
      within(exercise)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual(["Série 1 : 80 kg × 8", "Série 2 : 80 kg × 8Record : charge max"]);
    // Lecture seule : rien à modifier depuis l'historique.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("signale une séance introuvable", async () => {
    server.use(
      http.get(`*/api/v1/workouts/${ID}/`, () => new HttpResponse(null, { status: 404 })),
      http.get("*/api/v1/me/profile/", () => new HttpResponse(null, { status: 404 })),
    );
    renderWithQuery(<WorkoutDetail id={ID} />);

    expect(await screen.findByText(WORKOUT_NOT_FOUND)).toBeVisible();
    expect(screen.getByRole("link", { name: "Revenir aux séances" })).toBeVisible();
  });
});
