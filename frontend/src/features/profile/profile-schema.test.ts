import {
  defaultsFrom,
  profileFormSchema,
  toPayload,
  type ProfileFormValues,
} from "./profile-schema";

const METRIC: ProfileFormValues = {
  goal: "gain",
  unit_system: "metric",
  height_cm: "180",
  feet: "",
  inches: "",
};

function issues(values: ProfileFormValues): Record<string, string> {
  const result = profileFormSchema.safeParse(values);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [issue.path.join("."), issue.message]),
  );
}

describe("profileFormSchema", () => {
  it("accepte une taille en centimètres et l'envoie en mètres", () => {
    expect(issues(METRIC)).toEqual({});
    expect(toPayload(METRIC)).toEqual({ goal: "gain", unit_system: "metric", height_m: 1.8 });
  });

  it("accepte une taille en pieds et pouces", () => {
    const values = { ...METRIC, unit_system: "imperial", feet: "5", inches: "11" } as const;

    expect(issues(values)).toEqual({});
    expect(toPayload(values).height_m).toBe(1.8);
  });

  it.each(["99", "251", "", "abc", "180,5", "1.80"])(
    "refuse « %s » cm, avec un message sur le champ",
    (height_cm) => {
      expect(issues({ ...METRIC, height_cm })).toEqual({
        height_cm: "Saisissez une taille entre 100 et 250 cm.",
      });
    },
  );

  it.each([
    ["3", "3"],
    ["8", "3"],
    ["5", "12"],
    ["", "4"],
  ])("refuse %s ft %s in", (feet, inches) => {
    expect(issues({ ...METRIC, unit_system: "imperial", feet, inches })).toEqual({
      feet: "Saisissez une taille entre 3 ft 4 in et 8 ft 2 in.",
    });
  });

  it("accepte des pouces vides (taille ronde en pieds)", () => {
    expect(issues({ ...METRIC, unit_system: "imperial", feet: "6", inches: "" })).toEqual({});
  });

  it("exige un objectif", () => {
    expect(issues({ ...METRIC, goal: undefined as unknown as "gain" })).toEqual({
      goal: "Choisissez un objectif.",
    });
  });

  it("pré-remplit les deux systèmes d'unités depuis un profil existant", () => {
    expect(defaultsFrom({ goal: "cut", unit_system: "imperial", height_m: 1.8 })).toEqual({
      goal: "cut",
      unit_system: "imperial",
      height_cm: "180",
      feet: "5",
      inches: "11",
    });
  });
});
