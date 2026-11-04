import { render, screen } from "@testing-library/react";

import { FoodCredit } from "./food-picker";
import type { Food } from "./use-nutrition";

const FOOD: Food = {
  id: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  source: "ciqual",
  name: "Riz témoin, cuit",
  brand: "",
  kcal_100g: 150,
  protein_100g: 3,
  carbs_100g: 32,
  fat_100g: null,
  serving_g: null,
  is_custom: false,
  source_url: null,
};

describe("FoodCredit", () => {
  it("cite la table Ciqual et sa licence", () => {
    render(<FoodCredit food={FOOD} />);

    expect(screen.getByText("Table Ciqual 2025, Anses, Licence Ouverte Etalab 2.0.")).toBeVisible();
  });

  it("renvoie à la fiche Open Food Facts du produit", () => {
    const url = "https://world.openfoodfacts.org/product/3017620422003";
    render(<FoodCredit food={{ ...FOOD, source: "off", source_url: url }} />);

    expect(
      screen.getByRole("link", { name: "Données Open Food Facts, sous licence ODbL" }),
    ).toHaveAttribute("href", url);
  });

  it("ne mentionne rien pour un aliment perso", () => {
    const { container } = render(
      <FoodCredit food={{ ...FOOD, source: "custom", is_custom: true }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
