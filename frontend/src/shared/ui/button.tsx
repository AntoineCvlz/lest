import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` : l'action principale de l'écran (une seule par écran, en jaune). */
  variant?: Variant;
  /** `md` : 44 px de haut (cible tactile minimale). `lg` : 64 px, action principale en séance. */
  size?: Size;
  /** Occupe toute la largeur disponible (action principale en bas d'écran). */
  block?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-on-accent font-extrabold",
  secondary: "border border-line bg-surface text-ink font-bold",
  ghost: "bg-transparent text-ink font-bold hover:bg-surface",
};

const SIZES: Record<Size, string> = {
  md: "min-h-11 px-4 text-base",
  lg: "min-h-16 px-6 text-xl [font-stretch:112%]",
};

/** Bouton « Fonte calibrée » : `type="button"` par défaut, jamais un submit involontaire. */
export function Button({
  variant = "secondary",
  size = "md",
  block = false,
  type = "button",
  className,
  ...props
}: ButtonProps) {
  const classes = [
    "rounded-control inline-flex items-center justify-center gap-2",
    "transition-colors duration-[var(--lest-duration-fast)] ease-out",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    block ? "w-full" : "",
    className ?? "",
  ];
  return <button type={type} className={classes.filter(Boolean).join(" ")} {...props} />;
}
