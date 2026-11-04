import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { localDay, longDay, shiftDay } from "@/shared/lib/days";
import { ActivityJournal, durationText, NO_ACTIVITY, summaryText } from "./activity-journal";
import type { Activity } from "./use-activities";

const TODAY = localDay();
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const SPORTS = [
  {
    key: "running",
    label: "Course à pied",
    has_distance: true,
    metrics: [
      { key: "elevation_gain_m", label: "Dénivelé positif", unit: "m", min: 0, max: 10000 },
    ],
  },
  { key: "yoga", label: "Yoga ou mobilité", has_distance: false, metrics: [] },
  {
    key: "combat",
    label: "Sport de combat",
    has_distance: false,
    metrics: [{ key: "rounds", label: "Rounds", unit: "", min: 1, max: 100 }],
  },
];

const RUN: Activity = {
  id: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  date: shiftDay(TODAY, -2),
  sport: "running",
  duration_s: 2700,
  distance_m: 10200,
  avg_heart_rate: 148,
  feeling: 4,
  metrics: { elevation_gain_m: 120 },
};

function api({ activities = [RUN] as Activity[], unitSystem = "metric" } = {}) {
  const writes: { method: string; id: string; body?: unknown }[] = [];
  server.use(
    http.get("*/api/v1/sports/", () => HttpResponse.json(SPORTS)),
    http.get("*/api/v1/activities/", () => HttpResponse.json(activities)),
    http.get("*/api/v1/me/profile/", () =>
      HttpResponse.json({
        height_m: 1.8,
        goal: "gain",
        unit_system: unitSystem,
        one_rm_formula: "epley",
      }),
    ),
    http.put("*/api/v1/activities/:id/", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      writes.push({ method: "PUT", id: String(params.id), body });
      return HttpResponse.json({ id: params.id, ...body });
    }),
    http.delete("*/api/v1/activities/:id/", ({ params }) => {
      writes.push({ method: "DELETE", id: String(params.id) });
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return writes;
}

describe("textes", () => {
  it("écrit une durée lisible", () => {
    expect(durationText(2700)).toBe("45 min");
    expect(durationText(3900)).toBe("1 h 05");
  });

  it("résume les activités", () => {
    expect(summaryText([RUN, { ...RUN, duration_s: 1800 }])).toBe("2 activités, 1 h 15 au total.");
  });
});

describe("ActivityJournal", () => {
  it("note une course avec ses champs propres, en kilomètres", async () => {
    const writes = api({ activities: [] });
    const user = userEvent.setup();
    renderWithQuery(<ActivityJournal />);

    expect(await screen.findByText(NO_ACTIVITY)).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "Durée (min)" }), "45");
    await user.type(screen.getByRole("textbox", { name: "Distance (km)" }), "10,2");
    await user.type(screen.getByRole("textbox", { name: "Dénivelé positif (m)" }), "120");
    await user.selectOptions(screen.getByLabelText("Ressenti"), "4");
    await user.click(screen.getByRole("button", { name: "Enregistrer l’activité" }));

    expect(
      await screen.findByText(`Activité enregistrée : course à pied, ${longDay(TODAY)}.`),
    ).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.id).toMatch(UUID_V4);
    expect(writes[0]?.body).toEqual({
      date: TODAY,
      sport: "running",
      duration_s: 2700,
      distance_m: 10200,
      avg_heart_rate: null,
      feeling: 4,
      metrics: { elevation_gain_m: 120 },
    });
  });

  it("change les champs avec le sport : pas de distance au yoga, des rounds au combat", async () => {
    api({ activities: [] });
    const user = userEvent.setup();
    renderWithQuery(<ActivityJournal />);

    const sport = await screen.findByLabelText("Sport");
    await user.selectOptions(sport, "yoga");
    expect(screen.queryByRole("textbox", { name: "Distance (km)" })).not.toBeInTheDocument();
    await user.selectOptions(sport, "combat");
    expect(screen.getByRole("textbox", { name: "Rounds" })).toBeVisible();
  });

  it("refuse les valeurs hors bornes et met le focus sur la première", async () => {
    const writes = api({ activities: [] });
    const user = userEvent.setup();
    renderWithQuery(<ActivityJournal />);

    await user.type(await screen.findByRole("textbox", { name: "FC moyenne (bpm)" }), "300");
    await user.click(screen.getByRole("button", { name: "Enregistrer l’activité" }));

    const duration = screen.getByRole("textbox", { name: "Durée (min)" });
    expect(duration).toHaveFocus();
    expect(duration).toHaveAccessibleDescription("Nombre entier de 1 à 1 440.");
    expect(screen.getByRole("textbox", { name: "FC moyenne (bpm)" })).toHaveAccessibleDescription(
      /Nombre entier de 30 à 230\.$/,
    );
    expect(writes).toEqual([]);
  });

  it("montre le détail dans l'unité du profil", async () => {
    api({ unitSystem: "imperial" });
    renderWithQuery(<ActivityJournal />);

    const list = await screen.findByRole("list", { name: "Activités, les plus récentes d’abord" });
    expect(
      within(list).getByText(/^45\smin, 6,34\smi, FC moyenne 148, ressenti 4 sur 5/),
    ).toBeVisible();
    expect(screen.getByText(/^1 activité, 45\smin au total\.$/)).toBeVisible();
  });

  it("modifie une activité sous son identifiant, puis la supprime après confirmation", async () => {
    const writes = api();
    const user = userEvent.setup();
    renderWithQuery(<ActivityJournal />);

    await user.click(
      await screen.findByRole("button", {
        name: `Modifier l’activité : course à pied, ${longDay(RUN.date)}`,
      }),
    );
    expect(screen.getByLabelText("Sport")).toHaveFocus();
    const duration = screen.getByRole("textbox", { name: "Durée (min)" });
    expect(duration).toHaveValue("45");
    await user.clear(duration);
    await user.type(duration, "50");
    await user.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    await waitFor(() => {
      expect(writes[0]).toMatchObject({ method: "PUT", id: RUN.id, body: { duration_s: 3000 } });
    });

    await user.click(
      await screen.findByRole("button", {
        name: `Modifier l’activité : course à pied, ${longDay(RUN.date)}`,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    expect(screen.getByRole("button", { name: "Garder" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(
      await screen.findByText(`Activité supprimée : course à pied, ${longDay(RUN.date)}.`),
    ).toBeVisible();
    expect(writes[1]).toEqual({ method: "DELETE", id: RUN.id });
  });

  it("signale un catalogue indisponible", async () => {
    api();
    server.use(http.get("*/api/v1/sports/", () => new HttpResponse(null, { status: 503 })));
    renderWithQuery(<ActivityJournal />);

    expect(await screen.findByText("Activités indisponibles pour le moment.")).toBeVisible();
  });
});
