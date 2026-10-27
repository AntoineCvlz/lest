import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TextField } from "./text-field";

describe("TextField", () => {
  it("relie le libellé visible au champ", async () => {
    render(<TextField label="Adresse e-mail" type="email" />);

    const field = screen.getByRole("textbox", { name: "Adresse e-mail" });
    await userEvent.type(field, "a@example.com");

    expect(field).toHaveValue("a@example.com");
  });

  it("décrit le champ par son aide", () => {
    render(<TextField label="Mot de passe" hint="12 caractères au moins." />);

    expect(screen.getByRole("textbox", { name: "Mot de passe" })).toHaveAccessibleDescription(
      "12 caractères au moins.",
    );
  });

  it("marque le champ invalide et annonce l'erreur avec l'aide", () => {
    render(<TextField label="E-mail" hint="Votre adresse." error="Adresse invalide." />);

    const field = screen.getByRole("textbox", { name: "E-mail" });
    expect(field).toBeInvalid();
    expect(field).toHaveAccessibleDescription("Votre adresse. Adresse invalide.");
  });

  it("n'est pas invalide sans erreur", () => {
    render(<TextField label="E-mail" />);

    expect(screen.getByRole("textbox", { name: "E-mail" })).not.toBeInvalid();
  });
});
