import type { Schemas } from "@/shared/api/client";

export type Site = Schemas["MeasurementOut"]["site"];

/** Endroits mesurés, de haut en bas du corps : ordre du formulaire et des résumés. */
export const SITES: readonly { value: Site; label: string }[] = [
  { value: "neck", label: "Cou" },
  { value: "chest", label: "Poitrine" },
  { value: "arm", label: "Bras" },
  { value: "waist", label: "Taille" },
  { value: "hips", label: "Hanches" },
  { value: "thigh", label: "Cuisse" },
  { value: "calf", label: "Mollet" },
];
