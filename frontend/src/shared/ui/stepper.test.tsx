import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { Stepper } from "./stepper";

function Charge({ initial = 82.5, min = 20 }: { initial?: number; min?: number }) {
  const [kg, setKg] = useState(initial);
  return (
    <Stepper
      label="Charge"
      value={kg}
      onChange={setKg}
      step={2.5}
      min={min}
      unit="kilos"
      stepUnit="kilos"
    />
  );
}

describe("Stepper", () => {
  it("expose un groupe nommé par son libellé et affiche la valeur au format français", () => {
    render(<Charge />);

    expect(screen.getByRole("group", { name: "Charge" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("82,5kilos");
  });

  it("nomme chaque bouton à partir de son texte visible (commande vocale, WCAG 2.5.3)", () => {
    render(<Charge />);

    expect(screen.getByRole("button", { name: "−2,5 kilos" })).toHaveTextContent("−2,5");
    expect(screen.getByRole("button", { name: "+2,5 kilos" })).toHaveTextContent("+2,5");
  });

  it("ajoute et retire un pas", async () => {
    const user = userEvent.setup();
    render(<Charge />);

    await user.click(screen.getByRole("button", { name: "+2,5 kilos" }));
    expect(screen.getByRole("status")).toHaveTextContent("85");

    await user.click(screen.getByRole("button", { name: "−2,5 kilos" }));
    await user.click(screen.getByRole("button", { name: "−2,5 kilos" }));
    expect(screen.getByRole("status")).toHaveTextContent("80");
  });

  it("désactive la diminution au minimum (barre seule)", async () => {
    const user = userEvent.setup();
    render(<Charge initial={22.5} />);

    await user.click(screen.getByRole("button", { name: "−2,5 kilos" }));

    expect(screen.getByRole("status")).toHaveTextContent("20");
    expect(screen.getByRole("button", { name: "−2,5 kilos" })).toBeDisabled();
  });
});
