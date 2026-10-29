import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { NO_PENDING_LOGIN, SecondFactorForm } from "./second-factor-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const URL_2FA = "*/api/v1/auth/app/v1/auth/2fa/authenticate";

afterEach(() => {
  push.mockReset();
});

async function submit(code: string): Promise<void> {
  await userEvent.type(
    screen.getByRole("textbox", { name: "Code de vérification" }),
    `${code}{Enter}`,
  );
}

describe("SecondFactorForm", () => {
  it("envoie le code sans espaces puis ouvre la page demandée", async () => {
    let body: unknown;
    server.use(
      http.post(URL_2FA, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: 200, meta: { is_authenticated: true } });
      }),
    );
    renderWithQuery(<SecondFactorForm redirectTo="/profil" />);

    await submit("123 456");

    await vi.waitFor(() => {
      expect(push).toHaveBeenCalledWith("/profil");
    });
    expect(body).toEqual({ code: "123456" });
  });

  it("annonce un code incorrect sur le champ", async () => {
    server.use(
      http.post(URL_2FA, () =>
        HttpResponse.json(
          { status: 400, errors: [{ code: "incorrect_code", param: "code", message: "…" }] },
          { status: 400 },
        ),
      ),
    );
    renderWithQuery(<SecondFactorForm />);

    await submit("000000");

    expect(await screen.findByText(/^Code incorrect. Saisissez/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it.each([409, 401])(
    "propose de recommencer quand la connexion n'est plus en attente (%i)",
    async (status) => {
      server.use(http.post(URL_2FA, () => HttpResponse.json({ status }, { status })));
      renderWithQuery(<SecondFactorForm />);

      await submit("123456");

      expect(await screen.findByRole("alert")).toHaveTextContent(NO_PENDING_LOGIN);
    },
  );
});
