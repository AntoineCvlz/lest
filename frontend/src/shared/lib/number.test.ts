import { formatNumber, stepValue } from "./number";

describe("stepValue", () => {
  it("ajoute ou retire un pas", () => {
    expect(stepValue(82.5, 1, { step: 2.5 })).toBe(85);
    expect(stepValue(82.5, -1, { step: 2.5 })).toBe(80);
  });

  it("évite les erreurs d'arrondi des flottants", () => {
    // 0,1 + 0,2 = 0,30000000000000004 en virgule flottante.
    expect(stepValue(0.1, 1, { step: 0.2 })).toBe(0.3);
    expect(stepValue(1.25, 1, { step: 1.25 })).toBe(2.5);
  });

  it("reste dans les bornes", () => {
    expect(stepValue(20, -1, { step: 2.5, min: 20 })).toBe(20);
    expect(stepValue(500, 1, { step: 2.5, max: 500 })).toBe(500);
    expect(stepValue(1, -1, { step: 2.5, min: 0 })).toBe(0);
  });
});

describe("formatNumber", () => {
  it("utilise la virgule décimale française", () => {
    expect(formatNumber(82.5)).toBe("82,5");
    expect(formatNumber(1.25)).toBe("1,25");
  });

  it("n'affiche pas de décimales inutiles", () => {
    expect(formatNumber(80)).toBe("80");
    expect(formatNumber(7)).toBe("7");
  });

  it("groupe les milliers avec une espace insécable", () => {
    expect(formatNumber(12500)).toMatch(/^12\s500$/u);
  });
});
