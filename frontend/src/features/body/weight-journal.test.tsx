import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { localDay, longDay, shiftDay } from "./days";
import { bodyWeightText, trendSummary } from "./weight-chart";
import {
  DATE_OUT_OF_RANGE,
  NO_WEIGHT,
  parseWeight,
  WEIGHT_NOT_SAVED,
  WEIGHT_REFUSED,
  WeightJournal,
  WEIGHTS_UNAVAILABLE,
} from "./weight-journal";

const TODAY = localDay();
const YESTERDAY = shiftDay(TODAY, -1);

const FIRST = { date: shiftDay(TODAY, -2), weight_kg: 80, trend_kg: 80 };
const points = [FIRST, { date: YESTERDAY, weight_kg: 81.4, trend_kg: 80.7 }];

function api({
  weights = points,
  unitSystem = "metric",
}: { weights?: object[]; unitSystem?: string } = {}) {
  let query = "";
  server.use(
    http.get("*/api/v1/body-weights/", ({ request }) => {
      query = new URL(request.url).search;
      return HttpResponse.json(weights);
    }),
    http.get("*/api/v1/me/profile/", () =>
      HttpResponse.json({
        height_m: 1.8,
        goal: "gain",
        unit_system: unitSystem,
        one_rm_formula: "epley",
      }),
    ),
  );
  return { query: () => query };
}

describe("parseWeight", () => {
  it("lit la virgule ou le point, refuse le reste", () => {
    expect(parseWeight(" 81,4 ")).toBe(81.4);
    expect(parseWeight("81.4")).toBe(81.4);
    expect(parseWeight("81,4,2")).toBeNull();
    expect(parseWeight("-80")).toBeNull();
    expect(parseWeight("")).toBeNull();
  });
});

describe("trendSummary", () => {
  it("donne la dernière moyenne et l'évolution sur la période", () => {
    expect(trendSummary(points, "metric")).toBe(
      "Moyenne sur 7 jours : 80,7 kg. +0,7 kg sur la période.",
    );
    expect(trendSummary([FIRST, { ...FIRST, date: TODAY }], "metric")).toBe(
      "Moyenne sur 7 jours : 80 kg. Stable sur la période.",
    );
    expect(trendSummary([], "metric")).toBe("Aucune pesée sur la période.");
  });
});

describe("bodyWeightText", () => {
  it("arrondit au dixième, dans l'unité du profil", () => {
    expect(bodyWeightText(80.15, "metric")).toBe("80,2 kg");
    expect(bodyWeightText(80, "imperial")).toBe("176,4 lb");
  });
});

describe("WeightJournal", () => {
  it("pré-remplit la dernière pesée et enregistre celle du jour", async () => {
    const calls = api();
    let path = "";
    let body: unknown;
    server.use(
      http.put("*/api/v1/body-weights/:day/", async ({ request, params }) => {
        path = String(params.day);
        body = await request.json();
        return HttpResponse.json({ date: path, weight_kg: 81.2 }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<WeightJournal />);

    const field = await screen.findByRole("textbox", { name: "Poids (kg)" });
    await waitFor(() => {
      expect(field).toHaveValue("81,4");
    });
    expect(calls.query()).toBe(`?start=${shiftDay(TODAY, -29)}&end=${TODAY}`);
    await user.clear(field);
    await user.type(field, "81,2");
    await user.click(screen.getByRole("button", { name: "Enregistrer la pesée" }));

    expect(await screen.findByText(/^Pesée du .* enregistrée\.$/)).toBeVisible();
    expect(path).toBe(TODAY);
    expect(body).toEqual({ weight_kg: 81.2 });
  });

  it("refuse un poids hors plage sans appeler l'API", async () => {
    api();
    let called = false;
    server.use(
      http.put("*/api/v1/body-weights/:day/", () => {
        called = true;
        return HttpResponse.json({});
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<WeightJournal />);

    const field = await screen.findByRole("textbox", { name: "Poids (kg)" });
    await user.clear(field);
    await user.type(field, "8,2");
    await user.click(screen.getByRole("button", { name: "Enregistrer la pesée" }));

    expect(field).toHaveAccessibleDescription("Saisissez un poids entre 20 et 400 kg.");
    expect(field).toHaveFocus();
    expect(called).toBe(false);
  });

  it("annonce un échec d'enregistrement", async () => {
    api();
    server.use(
      http.put("*/api/v1/body-weights/:day/", () => new HttpResponse(null, { status: 503 })),
    );
    const user = userEvent.setup();
    renderWithQuery(<WeightJournal />);

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Enregistrer la pesée" }));

    expect(await screen.findByText(WEIGHT_NOT_SAVED)).toBeVisible();
  });

  it("affiche la courbe résumée et le tableau, plus récent d'abord", async () => {
    api();
    renderWithQuery(<WeightJournal />);

    expect(
      await screen.findByText("Moyenne sur 7 jours : 80,7 kg. +0,7 kg sur la période."),
    ).toBeVisible();
    expect(screen.getByRole("img", { name: "Courbe du poids sur la période" })).toBeVisible();
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("81,4 kg80,7 kg");
    expect(rows[2]).toHaveTextContent("80 kg80 kg");
  });

  it("change de période", async () => {
    const calls = api();
    const user = userEvent.setup();
    renderWithQuery(<WeightJournal />);

    await screen.findByRole("table");
    await user.click(screen.getByRole("radio", { name: "1 an" }));

    await waitFor(() => {
      expect(calls.query()).toBe(`?start=${shiftDay(TODAY, -364)}&end=${TODAY}`);
    });
  });

  it("affiche en livres pour un profil impérial et envoie des kilos", async () => {
    api({ unitSystem: "imperial" });
    let body: unknown;
    server.use(
      http.put("*/api/v1/body-weights/:day/", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ date: TODAY, weight_kg: 81.65 }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<WeightJournal />);

    const field = await screen.findByRole("textbox", { name: "Poids (lb)" });
    await user.clear(field);
    await user.type(field, "180");
    await user.click(screen.getByRole("button", { name: "Enregistrer la pesée" }));

    await waitFor(() => {
      expect(body).toEqual({ weight_kg: 81.65 });
    });
  });

  it("corrige puis supprime une pesée après confirmation", async () => {
    api();
    let deleted = "";
    server.use(
      http.delete("*/api/v1/body-weights/:day/", ({ params }) => {
        deleted = String(params.day);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<WeightJournal />);

    await user.click(
      await screen.findByRole("button", { name: `Modifier la pesée du ${longDay(FIRST.date)}` }),
    );
    expect(screen.getByRole("textbox", { name: "Poids (kg)" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Poids (kg)" })).toHaveValue("80");
    expect(screen.getByLabelText("Date")).toHaveValue(shiftDay(TODAY, -2));

    expect(screen.getByText(/^Modification de la pesée du /)).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Poids (kg)" })).toHaveAccessibleDescription(
      "Pesée déjà notée ce jour : 80 kg, remplacée à l’enregistrement.",
    );
    expect(screen.getByRole("button", { name: "Remplacer la pesée" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: /^Supprimer la pesée du / }));
    // Le choix sans danger reçoit le focus ; « Garder » le rend au bouton de suppression.
    expect(screen.getByRole("button", { name: "Garder" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Garder" }));
    expect(screen.getByRole("button", { name: /^Supprimer la pesée du / })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: /^Supprimer la pesée du / }));
    await user.click(
      screen.getByRole("button", { name: /^Confirmer la suppression de la pesée du / }),
    );

    expect(await screen.findByText(/^Pesée du .* supprimée\.$/)).toBeVisible();
    expect(deleted).toBe(shiftDay(TODAY, -2));
    expect(screen.getByRole("textbox", { name: "Poids (kg)" })).toHaveFocus();
  });

  it("reprend la pesée d'un jour déjà pesé quand on le choisit", async () => {
    api();
    renderWithQuery(<WeightJournal />);

    await screen.findByRole("table");
    const date = screen.getByLabelText("Date");
    fireEvent.change(date, { target: { value: FIRST.date } });

    expect(screen.getByRole("textbox", { name: "Poids (kg)" })).toHaveValue("80");
  });

  it("refuse une date hors plage et met le focus sur le champ", async () => {
    api();
    const user = userEvent.setup();
    renderWithQuery(<WeightJournal />);

    await screen.findByRole("table");
    const date = screen.getByLabelText("Date");
    fireEvent.change(date, { target: { value: "1999-12-31" } });
    await user.click(screen.getByRole("button", { name: "Enregistrer la pesée" }));

    expect(date).toHaveAccessibleDescription(DATE_OUT_OF_RANGE);
    expect(date).toHaveFocus();
  });

  it("distingue un refus de l'API d'une panne", async () => {
    api();
    server.use(
      http.put("*/api/v1/body-weights/:day/", () =>
        HttpResponse.json({ status: 422 }, { status: 422 }),
      ),
    );
    const user = userEvent.setup();
    renderWithQuery(<WeightJournal />);

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Enregistrer la pesée" }));

    expect(await screen.findByText(WEIGHT_REFUSED)).toBeVisible();
  });

  it("guide quand il n'y a aucune pesée", async () => {
    api({ weights: [] });
    renderWithQuery(<WeightJournal />);

    expect(await screen.findByText(NO_WEIGHT)).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Poids (kg)" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Enregistrer la pesée" })).toBeDisabled();
  });

  it("annonce une panne et permet de réessayer", async () => {
    let calls = 0;
    api();
    server.use(
      http.get("*/api/v1/body-weights/", () => {
        calls += 1;
        return calls === 1 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json(points);
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<WeightJournal />);

    expect(await screen.findByText(WEIGHTS_UNAVAILABLE)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(await screen.findByRole("table")).toBeVisible();
  });
});
