import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { PROGRAM_NOT_FOUND, ProgramEditor } from "./program-editor";
import { NO_PROGRAM, PROGRAM_NOT_SAVED, ProgramList } from "./program-list";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const PROGRAM_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const DAY_ID = "2b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const PLANNED_ID = "3b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const BENCH = "8c5b0f4e-9b1a-4d43-9d55-0d6d6b1f1a01";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const planned = {
  id: PLANNED_ID,
  day_id: DAY_ID,
  exercise_id: BENCH,
  position: 0,
  target_sets: 4,
  target_reps: 8,
  exercise_name: "Barbell Bench Press",
  exercise_name_language: "en",
  exercise_category: "chest",
  exercise_image: null,
};
const push_day = {
  id: DAY_ID,
  program_id: PROGRAM_ID,
  name: "Poussée",
  position: 0,
  exercises: [planned],
};
const ppl = { id: PROGRAM_ID, name: "PPL", days: [push_day] };

function programs(list: object[]) {
  server.use(http.get("*/api/v1/programs/", () => HttpResponse.json(list)));
}

/** Corps reçus par l'API simulée, par chemin. */
function captureWrites() {
  const writes: { method: string; path: string; body: unknown }[] = [];
  server.use(
    http.put("*/api/v1/:resource/:id/", async ({ request, params }) => {
      writes.push({
        method: "PUT",
        path: `${String(params.resource)}/${String(params.id)}`,
        body: await request.json(),
      });
      return HttpResponse.json({ id: params.id }, { status: 201 });
    }),
    http.delete("*/api/v1/:resource/:id/", ({ params }) => {
      writes.push({
        method: "DELETE",
        path: `${String(params.resource)}/${String(params.id)}`,
        body: null,
      });
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return writes;
}

afterEach(() => {
  push.mockReset();
});

describe("ProgramList", () => {
  it("résume chaque programme et mène à son édition", async () => {
    programs([ppl]);
    renderWithQuery(<ProgramList />);

    const link = within(await screen.findByRole("list", { name: "Mes programmes" })).getByRole(
      "link",
    );
    expect(link).toHaveTextContent("PPL1 séance type, 1 exercice");
    expect(link).toHaveAttribute("href", `/seance/programmes/${PROGRAM_ID}`);
  });

  it("crée un programme avec un identifiant v4 puis ouvre son édition", async () => {
    programs([]);
    const writes = captureWrites();
    const user = userEvent.setup();
    renderWithQuery(<ProgramList />);

    expect(await screen.findByText(NO_PROGRAM)).toBeVisible();
    const create = screen.getByRole("button", { name: "Créer le programme" });
    expect(create).toBeDisabled();
    await user.type(
      screen.getByRole("textbox", { name: "Nom du nouveau programme" }),
      "  Haut / bas ",
    );
    await user.click(create);

    await waitFor(() => {
      expect(push).toHaveBeenCalledOnce();
    });
    const [write] = writes;
    expect(write?.body).toEqual({ name: "Haut / bas" });
    const id = write?.path.split("/")[1] ?? "";
    expect(id).toMatch(UUID_V4);
    expect(push).toHaveBeenCalledWith(`/seance/programmes/${id}`);
  });

  it("annonce un échec d'enregistrement", async () => {
    programs([]);
    server.use(http.put("*/api/v1/programs/:id/", () => new HttpResponse(null, { status: 503 })));
    const user = userEvent.setup();
    renderWithQuery(<ProgramList />);

    await user.type(
      await screen.findByRole("textbox", { name: "Nom du nouveau programme" }),
      "PPL",
    );
    await user.click(screen.getByRole("button", { name: "Créer le programme" }));

    expect(await screen.findByText(PROGRAM_NOT_SAVED)).toBeVisible();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("ProgramEditor", () => {
  it("montre les séances types, leurs exercices et leur cible", async () => {
    programs([ppl]);
    renderWithQuery(<ProgramEditor id={PROGRAM_ID} />);

    expect(await screen.findByRole("heading", { level: 1, name: "PPL" })).toBeVisible();
    const day = screen.getByRole("region", { name: "Poussée" });
    expect(within(day).getByRole("listitem")).toHaveTextContent("Barbell Bench Press4 × 8");
  });

  it("modifie la cible d'un exercice", async () => {
    programs([ppl]);
    const writes = captureWrites();
    const user = userEvent.setup();
    renderWithQuery(<ProgramEditor id={PROGRAM_ID} />);

    await user.click(
      await screen.findByRole("button", { name: "Modifier la cible de Barbell Bench Press" }),
    );
    await user.click(screen.getByRole("button", { name: "+1 série" }));
    await user.click(screen.getByRole("button", { name: "−1 répétition" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer la cible" }));

    await waitFor(() => {
      expect(writes).toEqual([
        {
          method: "PUT",
          path: `program-exercises/${PLANNED_ID}`,
          body: {
            day_id: DAY_ID,
            exercise_id: BENCH,
            position: 0,
            target_sets: 5,
            target_reps: 7,
          },
        },
      ]);
    });
  });

  it("ajoute une séance type à la suite", async () => {
    programs([ppl]);
    const writes = captureWrites();
    const user = userEvent.setup();
    renderWithQuery(<ProgramEditor id={PROGRAM_ID} />);

    const section = await screen.findByRole("region", { name: "Nouvelle séance type" });
    await user.type(
      within(section).getByRole("textbox", { name: "Nom de la séance type" }),
      "Tirage",
    );
    await user.click(within(section).getByRole("button", { name: "Ajouter la séance type" }));

    await waitFor(() => {
      expect(writes[0]?.body).toEqual({ program_id: PROGRAM_ID, name: "Tirage", position: 1 });
    });
  });

  it("ajoute un exercice depuis la bibliothèque avec une cible par défaut", async () => {
    programs([{ ...ppl, days: [{ ...push_day, exercises: [] }] }]);
    server.use(
      http.get("*/api/v1/exercises/", () =>
        HttpResponse.json({
          items: [
            {
              id: BENCH,
              name: "Barbell Bench Press",
              name_language: "en",
              category: "chest",
              muscles: [],
              equipment: [],
              image: null,
            },
          ],
          next_cursor: null,
        }),
      ),
      http.get("*/api/v1/exercise-filters/", () =>
        HttpResponse.json({ categories: [], muscles: [], equipment: [] }),
      ),
    );
    const writes = captureWrites();
    const user = userEvent.setup();
    renderWithQuery(<ProgramEditor id={PROGRAM_ID} />);

    await user.click(await screen.findByRole("button", { name: "Ajouter un exercice" }));
    await user.click(await screen.findByRole("button", { name: /^Barbell Bench Press/ }));

    await waitFor(() => {
      expect(writes[0]?.body).toEqual({
        day_id: DAY_ID,
        exercise_id: BENCH,
        position: 0,
        target_sets: 3,
        target_reps: 10,
      });
    });
  });

  it("supprime le programme après confirmation et revient à la liste", async () => {
    programs([ppl]);
    const writes = captureWrites();
    const user = userEvent.setup();
    renderWithQuery(<ProgramEditor id={PROGRAM_ID} />);

    await user.click(await screen.findByRole("button", { name: "Supprimer le programme" }));
    await user.click(screen.getByRole("button", { name: "Garder" }));
    expect(writes).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Supprimer le programme" }));
    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/seance/programmes");
    });
    expect(writes).toEqual([{ method: "DELETE", path: `programs/${PROGRAM_ID}`, body: null }]);
  });

  it("signale un programme introuvable", async () => {
    programs([]);
    renderWithQuery(<ProgramEditor id={PROGRAM_ID} />);

    expect(await screen.findByText(PROGRAM_NOT_FOUND)).toBeVisible();
    expect(screen.getByRole("link", { name: "Revenir aux programmes" })).toBeVisible();
  });
});
