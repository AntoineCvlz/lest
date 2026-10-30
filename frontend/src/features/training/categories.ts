import type { Schemas } from "@/shared/api/client";

export type Category = Schemas["ExerciseOut"]["category"];

/** Libellés français des catégories du catalogue (valeurs de l'API). */
export const CATEGORY_LABELS: Record<Category, string> = {
  abs: "Abdominaux",
  arms: "Bras",
  back: "Dos",
  calves: "Mollets",
  cardio: "Cardio",
  chest: "Pectoraux",
  legs: "Jambes",
  shoulders: "Épaules",
};
