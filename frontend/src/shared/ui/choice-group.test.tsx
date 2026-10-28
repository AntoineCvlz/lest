import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { ChoiceGroup } from "./choice-group";

const RPE = [7, 7.5, 8, 8.5, 9].map((value) => ({ value, label: String(value).replace(".", ",") }));

function Rpe({ initial }: { initial?: number }) {
  const [rpe, setRpe] = useState(initial);
  return <ChoiceGroup legend="Effort ressenti (RPE)" options={RPE} value={rpe} onChange={setRpe} />;
}

describe("ChoiceGroup", () => {
  it("présente les options comme un groupe de boutons radio nommé", () => {
    render(<Rpe initial={8} />);

    expect(screen.getByRole("group", { name: "Effort ressenti (RPE)" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByRole("radio", { name: "8" })).toBeChecked();
  });

  it("sélectionne une option au clic", async () => {
    const user = userEvent.setup();
    render(<Rpe initial={8} />);

    await user.click(screen.getByText("8,5"));

    expect(screen.getByRole("radio", { name: "8,5" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "8" })).not.toBeChecked();
  });

  it("se pilote au clavier avec les flèches", async () => {
    const user = userEvent.setup();
    render(<Rpe initial={8} />);

    await user.tab();
    expect(screen.getByRole("radio", { name: "8" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("radio", { name: "8,5" })).toBeChecked();
  });

  it("n'a aucune option cochée tant que rien n'est choisi", () => {
    render(<Rpe />);

    for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
  });
});

describe("ChoiceGroup en colonne", () => {
  it("garde le comportement des boutons radio", async () => {
    function Goal() {
      const [goal, setGoal] = useState<string>();
      return (
        <ChoiceGroup
          legend="Objectif"
          layout="column"
          options={[
            { value: "gain", label: "Prise de masse" },
            { value: "cut", label: "Sèche" },
          ]}
          value={goal}
          onChange={setGoal}
        />
      );
    }
    render(<Goal />);

    await userEvent.click(screen.getByText("Prise de masse"));

    expect(screen.getByRole("radio", { name: "Prise de masse" })).toBeChecked();
  });
});
