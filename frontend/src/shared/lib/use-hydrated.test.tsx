import { renderToString } from "react-dom/server";
import { render, screen } from "@testing-library/react";

import { useHydrated } from "./use-hydrated";

function Probe() {
  return <p>{useHydrated() ? "hydraté" : "serveur"}</p>;
}

describe("useHydrated", () => {
  it("vaut false au rendu serveur", () => {
    expect(renderToString(<Probe />)).toContain("serveur");
  });

  it("vaut true une fois rendu dans le navigateur", () => {
    render(<Probe />);

    expect(screen.getByText("hydraté")).toBeInTheDocument();
  });
});
