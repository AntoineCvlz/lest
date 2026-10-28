import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/shared/test/msw-server";
import { renderWithQuery } from "@/shared/test/render";

import { NO_PENDING, VerifyEmailForm } from "./verify-email-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const VERIFY_URL = "*/api/v1/auth/app/v1/auth/email/verify";
const RESEND_URL = "*/api/v1/auth/app/v1/auth/email/verify/resend";

afterEach(() => {
  push.mockReset();
});

async function submitCode(code: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "Code reçu par e-mail" }), code);
  await user.keyboard("{Enter}");
}

describe("VerifyEmailForm", () => {
  it("envoie le code en majuscules, sans espaces, puis ouvre l'onboarding", async () => {
    let body: unknown;
    server.use(
      http.post(VERIFY_URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: 200, meta: { is_authenticated: true } });
      }),
    );
    renderWithQuery(<VerifyEmailForm />);

    await submitCode(" abcd-efgh ");

    await vi.waitFor(() => {
      expect(push).toHaveBeenCalledWith("/bienvenue");
    });
    expect(body).toEqual({ key: "ABCD-EFGH" });
  });

  it("annonce un code incorrect sur le champ", async () => {
    server.use(
      http.post(VERIFY_URL, () =>
        HttpResponse.json(
          { status: 400, errors: [{ code: "incorrect_code", param: "key", message: "…" }] },
          { status: 400 },
        ),
      ),
    );
    renderWithQuery(<VerifyEmailForm />);

    await submitCode("ABCD-0000");

    expect(await screen.findByText(/Code incorrect ou expiré/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("explique qu'aucune vérification n'est en cours (409)", async () => {
    server.use(http.post(VERIFY_URL, () => HttpResponse.json({ status: 409 }, { status: 409 })));
    renderWithQuery(<VerifyEmailForm />);

    await submitCode("ABCD-EFGH");

    expect(await screen.findByRole("alert")).toHaveTextContent(NO_PENDING);
  });

  it.each([
    [200, "Un nouveau code vient d’être envoyé."],
    [429, "Patientez avant d’en demander un autre."],
    [409, "Plus de renvoi possible pour ce code."],
  ])("renvoie un code et annonce le résultat (%i)", async (status, message) => {
    server.use(http.post(RESEND_URL, () => HttpResponse.json({ status }, { status })));
    renderWithQuery(<VerifyEmailForm />);

    await userEvent.click(screen.getByRole("button", { name: "Renvoyer un code" }));

    expect(await screen.findByRole("status")).toHaveTextContent(message);
  });
});
