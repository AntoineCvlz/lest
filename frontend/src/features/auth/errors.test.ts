import { formErrors, UNAVAILABLE } from "./errors";

describe("formErrors", () => {
  it("traduit les codes connus et range les erreurs par champ", () => {
    expect(
      formErrors({
        status: 400,
        errors: [
          { code: "required", param: "password", message: "This field is required." },
          { code: "email_password_mismatch", message: "…" },
        ],
      }),
    ).toEqual({
      fields: { password: "Ce champ est obligatoire." },
      global: ["Adresse e-mail ou mot de passe incorrect."],
    });
  });

  it("garde le message d'allauth pour un code inconnu", () => {
    expect(formErrors({ errors: [{ code: "autre", message: "Message allauth." }] }).global).toEqual(
      ["Message allauth."],
    );
  });

  it("garde la première erreur d'un champ et dédoublonne les messages généraux", () => {
    expect(
      formErrors({
        errors: [
          { code: "invalid", param: "email" },
          { code: "required", param: "email" },
          { code: "email_password_mismatch" },
          { code: "email_password_mismatch" },
        ],
      }),
    ).toEqual({
      fields: { email: "Saisissez une adresse e-mail valide." },
      global: ["Adresse e-mail ou mot de passe incorrect."],
    });
  });

  it.each([null, "texte", {}, { errors: [] }, { errors: "x" }])(
    "renvoie un message général pour un corps inattendu (%j)",
    (body) => {
      expect(formErrors(body)).toEqual({ fields: {}, global: [UNAVAILABLE] });
    },
  );
});

describe("erreurs de combinaison", () => {
  it.each(["email_password_mismatch", "too_many_login_attempts"])(
    "affiche %s en message général même rattaché au mot de passe",
    (code) => {
      const errors = formErrors({ errors: [{ code, param: "password", message: "…" }] });

      expect(errors.fields).toEqual({});
      expect(errors.global).toHaveLength(1);
    },
  );
});
