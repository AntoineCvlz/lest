import type { ReactNode } from "react";

/** Mise en page des écrans de compte : marque, titre, contenu, et un lien vers l'écran voisin. */
export function AuthPage({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-8 px-5 pt-8 pb-6 sm:min-h-0 sm:pt-16">
      <p className="text-2xl font-extrabold [font-stretch:125%]" aria-hidden="true">
        Lest
      </p>
      <div className="flex flex-col gap-3">
        <h1 className="text-[30px] leading-[1.05] font-extrabold [font-stretch:125%]">{title}</h1>
        {intro && <p className="text-ink-muted">{intro}</p>}
      </div>
      {children}
      {footer && <p className="text-ink-muted text-center">{footer}</p>}
    </main>
  );
}
