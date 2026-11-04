import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import {
  adherenceText,
  Dashboard,
  muscleRows,
  paceText,
  periodSummary,
  signedWeight,
  weekSummary,
} from "./dashboard";
import type { DashboardData } from "./use-dashboard";

const EMPTY_WEEK = {
  workouts: 0,
  workout_duration_s: 0,
  activities: 0,
  activity_duration_s: 0,
  distance_m: 0,
};
const MONDAYS = [
  "2026-09-14",
  "2026-09-21",
  "2026-09-28",
  "2026-10-05",
  "2026-10-12",
  "2026-10-19",
  "2026-10-26",
];

const DATA: DashboardData = {
  weight: {
    trend_kg: 79.2,
    change_4w_kg: 1.2,
    change_12w_kg: null,
    pace_kg_per_week: 0.3,
    goal: "gain",
    pace_range: { low_kg: 0.1, high_kg: 0.5 },
    pace_status: "within",
  },
  weeks: [
    ...MONDAYS.map((week) => ({ week, ...EMPTY_WEEK })),
    {
      week: "2026-11-02",
      workouts: 2,
      workout_duration_s: 7200,
      activities: 1,
      activity_duration_s: 1800,
      distance_m: 5000,
    },
  ],
  nutrition: {
    configured: true,
    kcal_target: 3010,
    protein_target: 160,
    last_7: { days: 7, logged_days: 5, kcal_days: 3, protein_days: 4 },
    last_28: { days: 28, logged_days: 20, kcal_days: 12, protein_days: 15 },
  },
  muscles: [
    { week: "2026-11-02", muscle: "Pectoraux", sets: 6, volume_kg: 3200 },
    { week: "2026-10-26", muscle: "Pectoraux", sets: 8, volume_kg: 4000 },
    { week: "2026-10-26", muscle: "Dorsaux", sets: 10, volume_kg: 5000 },
  ],
};

function api(data: DashboardData = DATA, unitSystem = "metric") {
  server.use(
    http.get("*/api/v1/insights/dashboard/", () => HttpResponse.json(data)),
    http.get("*/api/v1/me/profile/", () =>
      HttpResponse.json({
        height_m: 1.8,
        goal: "gain",
        unit_system: unitSystem,
        one_rm_formula: "epley",
      }),
    ),
  );
}

describe("textes du Bilan", () => {
  it("signe les variations de poids", () => {
    expect(signedWeight(1.2, "metric")).toBe("+1,2 kg");
    expect(signedWeight(-0.4, "metric")).toBe("−0,4 kg");
    expect(signedWeight(0, "metric")).toBe("0 kg");
    // En mots : le signe moins peut être tu par un lecteur d'écran.
    expect(signedWeight(-0.4, "metric", true)).toBe("baisse de 0,4 kg");
    expect(signedWeight(1.2, "metric", true)).toBe("hausse de 1,2 kg");
  });

  it("situe le rythme dans le repère de l'objectif", () => {
    expect(paceText(DATA.weight, "metric")).toBe(
      "+0,3 kg par semaine sur 4 semaines, dans le repère de la prise de masse (+0,1 kg à +0,5 kg).",
    );
    expect(paceText({ ...DATA.weight, pace_kg_per_week: null }, "metric")).toBeNull();
  });

  it("résume la semaine et l'adhérence", () => {
    expect(weekSummary(DATA.weeks.at(-1))).toBe(
      "Cette semaine : 2 séances de musculation (2 h 00) et 1 activité d’autres sports (30 min).",
    );
    expect(weekSummary(DATA.weeks[0])).toBe("Rien de noté cette semaine pour l’instant.");
    expect(adherenceText({ days: 7, logged_days: 5, kcal_days: 3, protein_days: 4 })).toBe(
      "5 jours notés sur 7 : énergie dans l’objectif 3 jours, protéines 4 jours.",
    );
    expect(adherenceText({ days: 7, logged_days: 0, kcal_days: 0, protein_days: 0 })).toBe(
      "Aucun repas noté sur les 7 derniers jours.",
    );
  });

  it("résume les 8 semaines", () => {
    expect(periodSummary(DATA.weeks)).toBe(
      "2 h 30 sur 8 semaines ; semaine la plus active : 2 nov. (2 h 30).",
    );
    expect(periodSummary(DATA.weeks.slice(0, 7))).toBe("Aucune activité notée sur 8 semaines.");
  });

  it("classe les muscles par séries sur 8 semaines", () => {
    expect(muscleRows(DATA.muscles, "2026-11-02")).toEqual([
      { muscle: "Pectoraux", thisWeek: 6, total: 14, volume: 3200 },
      { muscle: "Dorsaux", thisWeek: 0, total: 10, volume: 0 },
    ]);
  });
});

describe("Dashboard", () => {
  it("montre les quatre blocs, chacun avec son texte", async () => {
    api();
    renderWithQuery(<Dashboard />);

    expect(await screen.findByRole("heading", { name: "Poids" })).toBeVisible();
    expect(screen.getByText(/^79,2\skg$/)).toBeVisible();
    expect(screen.getByRole("img", { name: /^Temps actif par semaine/ })).toBeVisible();
    const weeks = screen.getByRole("table", {
      name: "Détail par semaine, la plus récente d’abord",
    });
    const latest = within(weeks).getAllByRole("row")[1];
    expect(latest).toHaveTextContent(/2 séances,\s2\sh\s00/);
    expect(latest).toHaveTextContent(/1 activité,\s30\smin/);
    expect(latest).toHaveTextContent(/5\skm/);
    expect(screen.getByText(/^20\sjours notés sur 28/)).toBeVisible();
    const muscles = screen.getByRole("table", { name: /^Séries de travail par muscle/ });
    expect(within(muscles).getAllByRole("row")[1]).toHaveTextContent(
      /Pectoraux.*6.*14.*3\s200\skg/,
    );
  });

  it("guide vers les écrans de saisie quand les blocs sont vides", async () => {
    api({
      ...DATA,
      weight: {
        ...DATA.weight,
        trend_kg: null,
        change_4w_kg: null,
        pace_kg_per_week: null,
        pace_status: null,
      },
      nutrition: {
        configured: false,
        kcal_target: null,
        protein_target: null,
        last_7: null,
        last_28: null,
      },
      muscles: [],
    });
    renderWithQuery(<Dashboard />);

    expect(await screen.findByRole("link", { name: "Noter une pesée" })).toHaveAttribute(
      "href",
      "/corps",
    );
    expect(screen.getByRole("link", { name: "Objectifs dans le profil" })).toHaveAttribute(
      "href",
      "/profil",
    );
    expect(screen.getByRole("link", { name: "Commencer une séance" })).toHaveAttribute(
      "href",
      "/seance",
    );
  });

  it("convertit en livres et en miles", async () => {
    api(DATA, "imperial");
    renderWithQuery(<Dashboard />);

    expect(await screen.findByText(/^174,6\slb$/)).toBeVisible();
    expect(screen.getByText(/3,11\smi/)).toBeVisible();
  });

  it("rend le focus au contenu après un nouvel essai réussi", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/v1/insights/dashboard/", () => {
        calls += 1;
        return calls === 1 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json(DATA);
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<Dashboard />);

    await user.click(await screen.findByRole("button", { name: "Réessayer" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Poids" })).toHaveFocus();
    });
  });

  it("signale un bilan indisponible", async () => {
    server.use(
      http.get("*/api/v1/insights/dashboard/", () => new HttpResponse(null, { status: 500 })),
    );
    renderWithQuery(<Dashboard />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bilan indisponible pour le moment.",
    );
  });
});
