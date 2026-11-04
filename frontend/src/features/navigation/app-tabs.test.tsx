import { render, screen, within } from "@testing-library/react";

import { AppTabs } from "./app-tabs";

const pathname = vi.fn(() => "/seance");
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));

describe("AppTabs", () => {
  it("signale l'onglet courant, sous-pages comprises", () => {
    pathname.mockReturnValue("/seance/activites");
    render(<AppTabs />);

    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Bilan",
      "Séance",
      "Repas",
      "Corps",
      "Profil",
    ]);
    expect(within(nav).getByRole("link", { name: "Séance" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Bilan" })).not.toHaveAttribute("aria-current");
  });

  it("signale le Bilan sur l'accueil seulement", () => {
    pathname.mockReturnValue("/");
    render(<AppTabs />);

    expect(screen.getByRole("link", { name: "Bilan" })).toHaveAttribute("aria-current", "page");
  });

  it("ne confond pas un préfixe de nom avec une sous-page", () => {
    pathname.mockReturnValue("/seances-passees");
    render(<AppTabs />);

    expect(screen.getByRole("link", { name: "Séance" })).not.toHaveAttribute("aria-current");
  });
});
