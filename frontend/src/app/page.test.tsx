import { render, screen } from "@testing-library/react";

import HomePage from "./page";

describe("HomePage", () => {
  it("affiche le nom de l’application comme titre principal", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Lest" })).toBeInTheDocument();
  });
});
