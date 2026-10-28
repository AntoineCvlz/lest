import Link from "next/link";
import type { ComponentProps } from "react";

/** Lien de texte entre écrans de compte : souligné (pas seulement coloré), cible de 44 px. */
export function TextLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={[
        "text-ink inline-flex min-h-11 items-center font-semibold underline underline-offset-4",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
