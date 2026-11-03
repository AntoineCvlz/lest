import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import type { Schemas } from "@/shared/api/client";
import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { localDay, shiftDay } from "./days";
import {
  DATE_OUT_OF_RANGE,
  fileProblem,
  NO_PHOTO,
  PHOTO_NOT_SENT,
  PHOTO_REFUSED,
  photoAlt,
  PhotoJournal,
} from "./photo-journal";

type Photo = Schemas["PhotoOut"];

const TODAY = localDay();
const OLD: Photo = {
  id: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  date: shiftDay(TODAY, -60),
  pose: "front",
};
const MID: Photo = {
  id: "2b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  date: shiftDay(TODAY, -30),
  pose: "front",
};
const NEW: Photo = {
  id: "3b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  date: shiftDay(TODAY, -1),
  pose: "front",
};
const SIDE: Photo = {
  id: "4b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  date: shiftDay(TODAY, -1),
  pose: "side",
};

function api(list: object[] = [OLD, MID, SIDE, NEW]) {
  server.use(http.get("*/api/v1/progress-photos/", () => HttpResponse.json(list)));
}

function picture(type = "image/jpeg", size = 1000): File {
  return new File([new Uint8Array(size)], "corps.jpg", { type });
}

beforeAll(() => {
  // jsdom n'a pas d'URL d'objet : un aperçu factice suffit.
  URL.createObjectURL = vi.fn(() => "blob:apercu");
  URL.revokeObjectURL = vi.fn();
});

describe("fileProblem", () => {
  it("refuse un type ou un poids hors limites", () => {
    expect(fileProblem(picture())).toBeNull();
    expect(fileProblem(picture("image/heic"))).toBe("Choisissez une photo JPEG, PNG ou WebP.");
    expect(fileProblem(picture("image/jpeg", 16 * 1024 * 1024))).toBe(
      "Photo trop lourde : 15 Mo au plus.",
    );
  });
});

describe("PhotoJournal", () => {
  it("envoie l'image brute avec sa pose et sa date sous un UUID v4", async () => {
    api([]);
    let sent: { path: string; query: string; type: string | null; size: number } | null = null;
    server.use(
      http.put("*/api/v1/progress-photos/:id/", async ({ request, params }) => {
        const body = await request.arrayBuffer();
        sent = {
          path: String(params.id),
          query: new URL(request.url).search,
          type: request.headers.get("content-type"),
          size: body.byteLength,
        };
        return HttpResponse.json({ id: params.id, date: TODAY, pose: "side" }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<PhotoJournal />);

    await screen.findByText(NO_PHOTO);
    await user.click(screen.getByRole("radio", { name: "Profil" }));
    await user.upload(screen.getByLabelText("Choisir une photo"), picture());
    expect(screen.getByRole("img", { name: "Aperçu avant envoi (profil)" })).toBeVisible();
    expect(screen.getByText("Photo choisie : corps.jpg, 0,1 Mo.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Envoyer la photo" }));

    expect(await screen.findByText(/^Photo \(profil\) du .* enregistrée\.$/)).toBeVisible();
    expect(sent).toEqual({
      path: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ) as string,
      query: `?date=${TODAY}&pose=side`,
      type: "image/jpeg",
      size: 1000,
    });
  });

  it("refuse un fichier hors limites sans l'envoyer", async () => {
    api([]);
    const user = userEvent.setup({ applyAccept: false });
    renderWithQuery(<PhotoJournal />);

    await screen.findByText(NO_PHOTO);
    const input = screen.getByLabelText("Choisir une photo");
    await user.upload(input, picture("image/heic"));

    expect(input).toHaveAccessibleDescription(
      expect.stringMatching(
        /^Choisissez une photo JPEG, PNG ou WebP\. Vos photos sont chiffrées/,
      ) as string,
    );
    await user.click(screen.getByRole("button", { name: "Envoyer la photo" }));
    // Le message précis reste (il dit pourquoi aucun fichier n'est retenu).
    expect(input).toHaveFocus();
    expect(screen.getByText("Choisissez une photo JPEG, PNG ou WebP.")).toBeVisible();
  });

  it("signale une date hors plage sur son champ", async () => {
    api([]);
    const user = userEvent.setup();
    renderWithQuery(<PhotoJournal />);

    await screen.findByText(NO_PHOTO);
    const date = screen.getByLabelText("Date");
    fireEvent.change(date, { target: { value: "1999-12-31" } });
    await user.upload(screen.getByLabelText("Choisir une photo"), picture());
    await user.click(screen.getByRole("button", { name: "Envoyer la photo" }));

    expect(date).toHaveFocus();
    expect(date).toHaveAccessibleDescription(DATE_OUT_OF_RANGE);
  });

  it("distingue une photo refusée d'une panne", async () => {
    api([]);
    let status = 422;
    server.use(http.put("*/api/v1/progress-photos/:id/", () => new HttpResponse(null, { status })));
    const user = userEvent.setup();
    renderWithQuery(<PhotoJournal />);

    await screen.findByText(NO_PHOTO);
    await user.upload(screen.getByLabelText("Choisir une photo"), picture());
    await user.click(screen.getByRole("button", { name: "Envoyer la photo" }));
    expect(await screen.findByText(PHOTO_REFUSED)).toBeVisible();

    status = 503;
    await user.click(screen.getByRole("button", { name: "Envoyer la photo" }));
    expect(await screen.findByText(PHOTO_NOT_SENT)).toBeVisible();
  });

  it("compare la première et la dernière photo d'une pose, dates modifiables", async () => {
    api();
    const user = userEvent.setup();
    renderWithQuery(<PhotoJournal />);

    // Grandes images de la comparaison, dans l'ordre (la galerie n'a que des vignettes).
    const compared = () =>
      screen
        .getAllByRole("img")
        .filter((image) => image.getAttribute("src")?.endsWith("/large/"))
        .map((image) => image.getAttribute("alt"));
    await screen.findByLabelText("Avant");
    expect(compared()).toEqual([photoAlt(OLD), photoAlt(NEW)]);
    await user.selectOptions(screen.getByLabelText("Avant"), MID.id);
    expect(compared()).toEqual([photoAlt(MID), photoAlt(NEW)]);

    const comparedPose = screen.getByRole("group", { name: "Pose comparée" });
    await user.click(within(comparedPose).getByRole("radio", { name: "Profil" }));
    expect(screen.getByText("Il faut au moins deux photos de profil pour comparer.")).toBeVisible();
  });

  it("supprime une photo après confirmation, le focus sur « Garder » d'abord", async () => {
    api();
    let deleted = "";
    server.use(
      http.delete("*/api/v1/progress-photos/:id/", ({ params }) => {
        deleted = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<PhotoJournal />);

    const gallery = await screen.findByRole("list", { name: "Photos, les plus récentes d’abord" });
    expect(within(gallery).getAllByRole("listitem")).toHaveLength(4);
    const name = `Supprimer la photo ${photoAlt(OLD)}`;
    await user.click(within(gallery).getByRole("button", { name }));
    expect(within(gallery).getByRole("button", { name: "Garder" })).toHaveFocus();
    await user.click(within(gallery).getByRole("button", { name: "Garder" }));
    expect(within(gallery).getByRole("button", { name })).toHaveFocus();
    expect(deleted).toBe("");

    await user.click(within(gallery).getByRole("button", { name }));
    await user.click(within(gallery).getByRole("button", { name: "Supprimer" }));

    await waitFor(() => {
      expect(deleted).toBe(OLD.id);
    });
    expect(await screen.findByText(/^Photo du .* supprimée\.$/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Toutes les photos" })).toHaveFocus();
  });

  it("remonte le focus à « Comparer » quand la dernière photo est supprimée", async () => {
    let list: Photo[] = [OLD];
    server.use(
      http.get("*/api/v1/progress-photos/", () => HttpResponse.json(list)),
      http.delete("*/api/v1/progress-photos/:id/", () => {
        list = [];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<PhotoJournal />);

    const gallery = await screen.findByRole("list", { name: "Photos, les plus récentes d’abord" });
    await user.click(within(gallery).getByRole("button", { name: /^Supprimer la photo / }));
    expect(
      within(gallery).getByRole("group", {
        name: "Supprimer cette photo ? Elle sera effacée définitivement.",
      }),
    ).toBeVisible();
    await user.click(within(gallery).getByRole("button", { name: "Supprimer" }));

    expect(await screen.findByText(NO_PHOTO)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Comparer" })).toHaveFocus();
    expect(screen.getByText(/^Photo du .* supprimée\.$/)).toBeVisible();
  });
});
