import {
  displayToKilograms,
  feetInchesToMetres,
  kilogramsToDisplay,
  lengthToMetres,
  metresToCentimetres,
  metresToFeetInches,
  metresToLength,
} from "./units";

describe("conversions de taille (stockage en mètres)", () => {
  it.each([
    [1.8, 180],
    [1.75, 175],
    [1.005, 101],
  ])("%f m = %i cm", (metres, centimetres) => {
    expect(metresToCentimetres(metres)).toBe(centimetres);
  });

  it.each([
    [5, 11, 1.8],
    [6, 0, 1.83],
    [5, 0, 1.52],
  ])("%i ft %i in ≈ %f m (au centimètre)", (feet, inches, metres) => {
    expect(feetInchesToMetres(feet, inches)).toBe(metres);
  });

  it.each([
    [1.8, { feet: 5, inches: 11 }],
    [1.83, { feet: 6, inches: 0 }],
    // 1,82 m = 71,65 in : arrondi à 72 in, soit 6 ft 0 in (jamais « 5 ft 12 in »).
    [1.82, { feet: 6, inches: 0 }],
  ])("%f m ≈ %o", (metres, expected) => {
    expect(metresToFeetInches(metres)).toEqual(expected);
  });

  it("revient à la même taille après un aller-retour en pieds et pouces", () => {
    const { feet, inches } = metresToFeetInches(1.8);

    expect(feetInchesToMetres(feet, inches)).toBe(1.8);
  });
});

describe("conversions de charge (stockage en kilos)", () => {
  it("garde les kilos au centième", () => {
    expect(kilogramsToDisplay(82.5, "metric")).toBe(82.5);
    expect(displayToKilograms(82.5, "metric")).toBe(82.5);
  });

  it("convertit les livres sans dériver d'un aller-retour", () => {
    expect(displayToKilograms(225, "imperial")).toBe(102.06);
    expect(kilogramsToDisplay(102.06, "imperial")).toBe(225);
    for (const pounds of [45, 135, 185, 315, 2.5]) {
      expect(kilogramsToDisplay(displayToKilograms(pounds, "imperial"), "imperial")).toBe(pounds);
    }
  });
});

describe("conversions des mensurations (stockage en mètres)", () => {
  it.each([
    [0.385, "metric", 38.5],
    [0.385, "imperial", 15.2],
  ] as const)("%f m = %f (%s)", (metres, system, value) => {
    expect(metresToLength(metres, system)).toBe(value);
  });

  it.each([
    [38.5, "metric", 0.385],
    [15.2, "imperial", 0.386],
  ] as const)("%f (%s) = %f m", (value, system, metres) => {
    expect(lengthToMetres(value, system)).toBe(metres);
  });
});
