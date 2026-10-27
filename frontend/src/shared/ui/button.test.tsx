import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "./button";

describe("Button", () => {
  it("est un bouton simple par défaut, jamais un envoi de formulaire involontaire", () => {
    render(<Button>Valider</Button>);

    expect(screen.getByRole("button", { name: "Valider" })).toHaveAttribute("type", "button");
  });

  it("respecte un type explicite", () => {
    render(<Button type="submit">Créer mon compte</Button>);

    expect(screen.getByRole("button", { name: "Créer mon compte" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("déclenche l'action au clic et au clavier", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Valider la série</Button>);

    await user.tab();
    expect(screen.getByRole("button", { name: "Valider la série" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Valider la série" }));

    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("n'agit pas quand il est désactivé", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Valider
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Valider" }));

    expect(onClick).not.toHaveBeenCalled();
  });
});
