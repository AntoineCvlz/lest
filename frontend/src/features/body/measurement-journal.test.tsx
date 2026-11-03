import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { localDay, longDay, shiftDay } from "./days";
import {
  changeText,
  MEASUREMENTS_NOT_SAVED,
  MeasurementJournal,
  NO_MEASUREMENT,
  NOTHING_CHANGED,
} from "./measurement-journal";

const TODAY = localDay();
const EARLIER = shiftDay(TODAY, -30);
const LATER = shiftDay(TODAY, -2);

const rows = [
  { date: EARLIER, site: "arm", length_m: 0.37 },
  { date: EARLIER, site: "waist", length_m: 0.82 },
  { date: LATER, site: "arm", length_m: 0.385 },
] as const;

function api({ measurements = [...rows] as object[], unitSystem = "metric" } = {}) {
  server.use(
    http.get("*/api/v1/body-measurements/", () => HttpResponse.json(measurements)),
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

/** Écritures reçues par l'API, dans l'ordre : « PUT arm 0.39 », « DELETE waist ». */
function recordWrites(status = 200) {
  const writes: string[] = [];
  server.use(
    http.put("*/api/v1/body-measurements/:day/:site/", async ({ request, params }) => {
      const body = (await request.json()) as { length_m: number };
      writes.push(`PUT ${String(params.day)} ${String(params.site)} ${String(body.length_m)}`);
      return status === 200
        ? HttpResponse.json({ date: params.day, site: params.site, length_m: body.length_m })
        : new HttpResponse(null, { status });
    }),
    http.delete("*/api/v1/body-measurements/:day/:site/", ({ params }) => {
      writes.push(`DELETE ${String(params.day)} ${String(params.site)}`);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return writes;
}

describe("changeText", () => {
  it("donne l'évolution depuis la première mesure", () => {
    expect(changeText(rows[0], rows[2], "metric")).toMatch(/^\+1,5\scm depuis le /);
    expect(changeText(rows[0], rows[0], "metric")).toBeNull();
  });
});

describe("MeasurementJournal", () => {
  it("résume la dernière mesure et l'évolution par endroit", async () => {
    api();
    renderWithQuery(<MeasurementJournal />);

    const terms = await screen.findAllByRole("term");
    expect(terms.map((term) => term.textContent)).toEqual(["Bras", "Taille"]);
    expect(screen.getByText("38,5 cm")).toBeVisible();
    expect(screen.getByText(/^, \+1,5\scm depuis le /)).toBeVisible();
    const history = screen.getByRole("list", { name: "Mensurations par date" });
    expect(within(history).getAllByRole("listitem")[0]).toHaveTextContent("Bras 38,5 cm");
    expect(screen.getByRole("textbox", { name: "Bras (cm)" })).toHaveAccessibleDescription(
      expect.stringMatching(/^Dernière : 38,5\scm, le /) as string,
    );
  });

  it("n'envoie que les endroits mesurés, en mètres", async () => {
    api();
    const writes = recordWrites();
    const user = userEvent.setup();
    renderWithQuery(<MeasurementJournal />);

    await screen.findByRole("list", { name: "Mensurations par date" });
    await user.type(screen.getByRole("textbox", { name: "Bras (cm)" }), "39");
    await user.type(screen.getByRole("textbox", { name: "Taille (cm)" }), "81,5");
    await user.click(screen.getByRole("button", { name: "Enregistrer les mesures" }));

    expect(await screen.findByText(/^Mensurations du .* enregistrées\.$/)).toBeVisible();
    expect(writes.toSorted()).toEqual([`PUT ${TODAY} arm 0.39`, `PUT ${TODAY} waist 0.815`]);
  });

  it("corrige une date : un champ vidé supprime sa mesure, une valeur inchangée n'est pas renvoyée", async () => {
    api();
    const writes = recordWrites();
    const user = userEvent.setup();
    renderWithQuery(<MeasurementJournal />);

    await user.click(
      await screen.findByRole("button", {
        name: `Modifier les mensurations du ${longDay(EARLIER)}`,
      }),
    );
    expect(screen.getByRole("textbox", { name: "Cou (cm)" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Bras (cm)" })).toHaveValue("37");
    await user.clear(screen.getByRole("textbox", { name: "Taille (cm)" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer les mesures" }));

    await waitFor(() => {
      expect(writes).toEqual([`DELETE ${EARLIER} waist`]);
    });
  });

  it("refuse une mesure hors plage et met le focus sur le champ", async () => {
    api();
    const writes = recordWrites();
    const user = userEvent.setup();
    renderWithQuery(<MeasurementJournal />);

    await screen.findByRole("list", { name: "Mensurations par date" });
    const calf = screen.getByRole("textbox", { name: "Mollet (cm)" });
    await user.type(calf, "4");
    await user.click(screen.getByRole("button", { name: "Enregistrer les mesures" }));

    expect(calf).toHaveFocus();
    expect(calf).toHaveAccessibleDescription("Entre 10 et 250 cm.");
    expect(writes).toEqual([]);
  });

  it("dit quand rien n'a changé", async () => {
    api();
    const user = userEvent.setup();
    renderWithQuery(<MeasurementJournal />);

    await screen.findByRole("list", { name: "Mensurations par date" });
    await user.click(screen.getByRole("button", { name: "Enregistrer les mesures" }));

    expect(screen.getByText(NOTHING_CHANGED)).toBeVisible();
  });

  it("annonce un échec d'enregistrement", async () => {
    api();
    recordWrites(503);
    const user = userEvent.setup();
    renderWithQuery(<MeasurementJournal />);

    await screen.findByRole("list", { name: "Mensurations par date" });
    await user.type(screen.getByRole("textbox", { name: "Cou (cm)" }), "40");
    await user.click(screen.getByRole("button", { name: "Enregistrer les mesures" }));

    expect(await screen.findByText(MEASUREMENTS_NOT_SAVED)).toBeVisible();
  });

  it("affiche en pouces pour un profil impérial et envoie des mètres", async () => {
    api({ unitSystem: "imperial" });
    const writes = recordWrites();
    const user = userEvent.setup();
    renderWithQuery(<MeasurementJournal />);

    await screen.findByRole("list", { name: "Mensurations par date" });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: LATER } });
    expect(screen.getByRole("textbox", { name: "Bras (in)" })).toHaveValue("15,2");
    await user.type(screen.getByRole("textbox", { name: "Cou (in)" }), "15");
    await user.click(screen.getByRole("button", { name: "Enregistrer les mesures" }));

    await waitFor(() => {
      expect(writes).toEqual([`PUT ${LATER} neck 0.381`]);
    });
  });

  it("guide quand il n'y a aucune mensuration", async () => {
    api({ measurements: [] });
    renderWithQuery(<MeasurementJournal />);

    expect(await screen.findByText(NO_MEASUREMENT)).toBeVisible();
  });
});
