import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { localDay, longDay, shiftDay } from "./days";
import { bodyWeightText, trendSummary } from "./weight-chart";
import {
  NO_WEIGHT,
  parseWeight,
  WEIGHT_NOT_SAVED,
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
      await screen.findByRole("img", {
        name: "Moyenne sur 7 jours : 80,7 kg. +0,7 kg sur la période.",
      }),
    ).toBeVisible();
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

    await user.click(screen.getByRole("button", { name: /^Supprimer la pesée du / }));
    await user.click(screen.getByRole("button", { name: "Confirmer la suppression" }));

    expect(await screen.findByText(/^Pesée du .* supprimée\.$/)).toBeVisible();
    expect(deleted).toBe(shiftDay(TODAY, -2));
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
