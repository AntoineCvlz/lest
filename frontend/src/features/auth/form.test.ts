import { awaitsEmailVerification, pendingSecondFactorTypes } from "./form";

describe("awaitsEmailVerification", () => {
  it("reconnaît une vérification d'e-mail en attente", () => {
    expect(
      awaitsEmailVerification({
        status: 401,
        data: { flows: [{ id: "login" }, { id: "verify_email", is_pending: true }] },
      }),
    ).toBe(true);
  });

  it.each([
    ["un second facteur", { data: { flows: [{ id: "mfa_authenticate", is_pending: true }] } }],
    ["une vérification non en attente", { data: { flows: [{ id: "verify_email" }] } }],
    ["une session simplement absente", { status: 401, meta: { is_authenticated: false } }],
    ["un corps vide", null],
  ])("ne confond pas avec %s", (_label, body) => {
    expect(awaitsEmailVerification(body)).toBe(false);
  });
});

describe("pendingSecondFactorTypes", () => {
  it("donne les méthodes du compte quand un second facteur est attendu", () => {
    const body = {
      data: {
        flows: [
          { id: "login" },
          { id: "mfa_authenticate", is_pending: true, types: ["recovery_codes", "webauthn", 3] },
        ],
      },
    };
    expect(pendingSecondFactorTypes(body)).toEqual(["recovery_codes", "webauthn"]);
  });

  it("renvoie null sans connexion en attente", () => {
    expect(pendingSecondFactorTypes({ data: { flows: [{ id: "mfa_authenticate" }] } })).toBeNull();
    expect(pendingSecondFactorTypes({ meta: { is_authenticated: false } })).toBeNull();
  });
});
