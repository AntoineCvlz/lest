import type { ReactNode } from "react";

import type { Schemas } from "@/shared/api/client";

import type { Category } from "./categories";

type Size = "thumb" | "small" | "large";

const FRAMES: Record<Size, string> = {
  thumb: "size-14",
  small: "size-20",
  large: "aspect-square w-full max-w-80",
};
// Taille de l'image servie (640 px), affichée à ces dimensions : le navigateur la réduit.
const PIXELS = 640;

/**
 * Pictogrammes maison par catégorie (ADR 0005), au trait, dans le même cadre que les images :
 * ils remplacent l'image des exercices qui n'en ont pas.
 */
const PICTOGRAMS: Record<Category, ReactNode> = {
  // Tapis et buste qui s'enroule.
  abs: <path d="M8 38h32M14 38c2-8 8-14 16-14M30 24a4 4 0 1 0 0-.1M20 31l6-4" />,
  // Haltère tenue en flexion.
  arms: <path d="M14 34h20M10 30v8M14 28v12M34 28v12M38 30v8M24 34V20M24 20l-6-6" />,
  // Barre de traction et prise large.
  back: <path d="M6 10h36M14 10v6M34 10v6M14 16l10 8 10-8M24 24v14M24 30a4 4 0 1 0 0-.1" />,
  // Talons levés sur une marche.
  calves: <path d="M10 40h28v-4H10zM18 36l2-12M28 36l-2-12M20 24h6M18 36h-4M28 36h4" />,
  // Tracé de pouls.
  cardio: <path d="M6 26h9l4-10 6 20 5-14 3 4h9" />,
  // Banc et barre chargée.
  chest: <path d="M8 18h32M10 13v10M14 11v14M34 11v14M38 13v10M12 32h24M16 32v8M32 32v8" />,
  // Cage de squat et barre sur les épaules.
  legs: <path d="M10 8v32M38 8v32M8 18h32M24 18v8M24 26l-6 6v8M24 26l6 6v8" />,
  // Barre au-dessus de la tête, bras tendus.
  shoulders: <path d="M8 10h32M12 6v8M36 6v8M16 10l6 12M32 10l-6 12M22 22h4M24 22v16" />,
};

/**
 * Image d'un exercice dans un cadre carré blanc, identique partout (vignette, saisie, fiche).
 * Sans image : pictogramme de la catégorie. Décorative par défaut (le nom de l'exercice est à
 * côté) ; `alt` la décrit quand elle est seule, comme sur la fiche.
 */
export function ExerciseImage({
  image,
  category,
  size,
  alt = "",
}: {
  image: Schemas["ImageOut"] | null;
  category: Category;
  size: Size;
  alt?: string;
}) {
  return (
    <span
      className={[
        "rounded-control bg-tile border-line-subtle flex shrink-0 items-center justify-center",
        "overflow-hidden border",
        FRAMES[size],
      ].join(" ")}
    >
      {image ? (
        // Déjà normalisée par l'API (WebP 640 px, ADR 0005). Pas `next/image` : il pose un
        // attribut `style` en ligne, refusé par la CSP de prod.
        <picture className="size-full">
          <source srcSet={image.url} type="image/webp" />
          <img
            src={image.url}
            alt={alt}
            width={PIXELS}
            height={PIXELS}
            loading={size === "large" ? "eager" : "lazy"}
            decoding="async"
            className="size-full object-contain"
          />
        </picture>
      ) : (
        <svg
          viewBox="0 0 48 48"
          role={alt ? "img" : undefined}
          aria-label={alt || undefined}
          aria-hidden={alt ? undefined : true}
          className="text-tile-ink size-3/5 fill-none stroke-current stroke-[2.5] [stroke-linecap:round] [stroke-linejoin:round]"
        >
          {PICTOGRAMS[category]}
        </svg>
      )}
    </span>
  );
}
