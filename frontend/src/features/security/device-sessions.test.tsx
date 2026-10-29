import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { UNAVAILABLE } from "../auth/errors";
import {
  DEVICE_SESSIONS_KEY,
  DEVICE_SIGNED_OUT,
  DeviceSessions,
  OTHERS_SIGNED_OUT,
  SESSION_ENDED,
  SESSIONS_UNAVAILABLE,
} from "./device-sessions";

const URL = "*/api/v1/auth/app/v1/auth/sessions";
const OCTOBER_29 = 1_793_260_800; // 29 octobre 2026, 12 h UTC
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const LINUX_FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0";

function session(id: number, user_agent: string, is_current = false, ip = "203.0.113.7") {
  return { id, user_agent, ip, created_at: OCTOBER_29 - id, last_seen_at: OCTOBER_29, is_current };
}

const current = session(1, WINDOWS_CHROME, true);
const phone = session(2, IPHONE);
const laptop = session(3, LINUX_FIREFOX, false, "198.51.100.4");

function listing(sessions: object[]) {
  return http.get(URL, () => HttpResponse.json({ status: 200, data: sessions }));
}

describe("DeviceSessions", () => {
  it("liste les appareils, celui-ci d'abord, sans proposer de le déconnecter", async () => {
    server.use(listing([phone, current]));
    renderWithQuery(<DeviceSessions />);

    const items = within(
      await screen.findByRole("list", { name: "Appareils connectés" }),
    ).getAllByRole("listitem");

    expect(items[0]).toHaveTextContent("Chrome sur Windows (cet appareil)");
    expect(items[0]).toHaveTextContent("Connecté le 29 octobre 2026");
    const [first] = items;
    if (!first) throw new Error("liste vide");
    expect(within(first).queryByRole("button")).not.toBeInTheDocument();
    expect(items[1]).toHaveTextContent("Safari sur iOS");
    expect(items[1]).toHaveTextContent("Adresse IP : 203.0.113.7");
  });

  it("déconnecte un appareil et met la liste à jour", async () => {
    let body: unknown;
    server.use(
      listing([current, phone]),
      http.delete(URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: 200, data: [current] });
      }),
    );
    renderWithQuery(<DeviceSessions />);

    await userEvent.click(
      await screen.findByRole("button", { name: /^Déconnecter Safari sur iOS/ }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(DEVICE_SIGNED_OUT);
    expect(body).toEqual({ sessions: [2] });
    expect(screen.queryByText("Safari sur iOS")).not.toBeInTheDocument();
  });

  it("déconnecte tous les autres appareils d'un coup", async () => {
    let body: unknown;
    server.use(
      listing([current, phone, laptop]),
      http.delete(URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: 200, data: [current] });
      }),
    );
    renderWithQuery(<DeviceSessions />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Déconnecter les autres appareils" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(OTHERS_SIGNED_OUT);
    expect(body).toEqual({ sessions: [2, 3] });
    expect(
      screen.queryByRole("button", { name: "Déconnecter les autres appareils" }),
    ).not.toBeInTheDocument();
  });

  it("ne propose pas « les autres appareils » pour un seul autre appareil", async () => {
    server.use(listing([current, phone]));
    renderWithQuery(<DeviceSessions />);

    await screen.findByText("Safari sur iOS");

    expect(
      screen.queryByRole("button", { name: "Déconnecter les autres appareils" }),
    ).not.toBeInTheDocument();
  });

  it("annonce un échec de déconnexion et recharge la liste", async () => {
    let listed = 0;
    server.use(
      http.get(URL, () => {
        listed += 1;
        return HttpResponse.json({ status: 200, data: [current, phone] });
      }),
      http.delete(URL, () => HttpResponse.json({ status: 500 }, { status: 500 })),
    );
    renderWithQuery(<DeviceSessions />);

    await userEvent.click(
      await screen.findByRole("button", { name: /^Déconnecter Safari sur iOS/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(UNAVAILABLE);
    await waitFor(() => {
      expect(listed).toBe(2);
    });
  });

  it("propose de réessayer si la liste ne se charge pas", async () => {
    server.use(http.get(URL, () => HttpResponse.json({ status: 500 }, { status: 500 })));
    renderWithQuery(<DeviceSessions />);

    expect(await screen.findByText(SESSIONS_UNAVAILABLE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });

  it("ne rend jamais le user agent brut (contrôlé par l'appareil distant)", async () => {
    server.use(listing([current, session(4, '<img src=x onerror="alert(1)">')]));
    renderWithQuery(<DeviceSessions />);

    const list = await screen.findByRole("list", { name: "Appareils connectés" });

    expect(within(list).getByText("Appareil inconnu")).toBeInTheDocument();
    expect(list.querySelector("img")).toBeNull();
    expect(list).not.toHaveTextContent("onerror");
  });

  it("vide le cache si cette session a pris fin entre-temps", async () => {
    // Session close côté serveur : toute nouvelle lecture répond 401 elle aussi.
    let ended = false;
    const unauthorized = () =>
      HttpResponse.json({ status: 401, meta: { is_authenticated: false } }, { status: 401 });
    server.use(
      http.get(URL, () =>
        ended ? unauthorized() : HttpResponse.json({ status: 200, data: [current, phone] }),
      ),
      http.delete(URL, () => {
        ended = true;
        return unauthorized();
      }),
    );
    const { queryClient } = renderWithQuery(<DeviceSessions />);
    queryClient.setQueryData(["profile"], { goal: "gain" });

    await userEvent.click(
      await screen.findByRole("button", { name: /^Déconnecter Safari sur iOS/ }),
    );

    expect(await screen.findByText(SESSION_ENDED)).toBeInTheDocument();
    expect(queryClient.getQueryData(["profile"])).toBeUndefined();
    expect(queryClient.getQueryData(DEVICE_SESSIONS_KEY)).toBeUndefined();
  });
});
