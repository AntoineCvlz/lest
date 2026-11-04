"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const ICON =
  "size-6 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]";

export const TABS: readonly { href: string; label: string; icon: ReactNode }[] = [
  {
    href: "/",
    label: "Bilan",
    // Trois barres montantes : le bilan des semaines.
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={ICON}>
        <path d="M4 20h16M7 16v-4M12 16V8M17 16V5" />
      </svg>
    ),
  },
  {
    href: "/seance",
    label: "Séance",
    // Barre chargée : deux disques de chaque côté.
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={ICON}>
        <path d="M2 12h20M5 8v8M8 6v12M16 6v12M19 8v8" />
      </svg>
    ),
  },
  {
    href: "/repas",
    label: "Repas",
    // Assiette vue de dessus, couverts de part et d'autre.
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={ICON}>
        <circle cx="12" cy="12" r="6" />
        <path d="M3 4v6M3 7h1M21 4v16" />
      </svg>
    ),
  },
  {
    href: "/corps",
    label: "Corps",
    // Pèse-personne : plateau et cadran.
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={ICON}>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M8 10a4 4 0 0 1 8 0M12 10l1.5-2.5" />
      </svg>
    ),
  },
  {
    href: "/profil",
    label: "Profil",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={ICON}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
      </svg>
    ),
  },
];

const ITEM = "flex min-h-16 flex-col items-center justify-center gap-1 text-sm font-semibold";
const LIST = "mx-auto flex max-w-2xl flex-wrap";
const CELL = "min-w-fit flex-1 basis-16";
const BAR = "border-t pb-[env(safe-area-inset-bottom)]";

/**
 * Onglets du bas, dans la zone du pouce (CLAUDE.md) : l'onglet courant porte `aria-current`.
 *
 * La barre est fixée en bas de l'écran. Un double invisible, dans le flux de la page, réserve
 * exactement sa hauteur : avec un texte agrandi, les onglets passent à la ligne, la barre grandit
 * et la réserve avec elle, sans que la fin de la page passe dessous (WCAG 1.4.4). Le double est
 * masqué (`invisible`, `aria-hidden`) : ni lu, ni focalisable.
 */
export function AppTabs() {
  const pathname = usePathname();

  return (
    <>
      <div aria-hidden="true" className={`invisible ${BAR}`}>
        <div className={LIST}>
          {TABS.map((tab) => (
            <span key={tab.href} className={`${CELL} ${ITEM}`}>
              {tab.icon}
              <span className="border-b-2 border-transparent">{tab.label}</span>
            </span>
          ))}
        </div>
      </div>
      <nav
        aria-label="Navigation principale"
        className={`border-line-subtle bg-ground fixed inset-x-0 bottom-0 ${BAR}`}
      >
        <ul className={LIST}>
          {TABS.map((tab) => {
            // L'accueil ne couvre que lui-même (toutes les pages commencent par « / »).
            const current =
              pathname === tab.href || (tab.href !== "/" && pathname.startsWith(`${tab.href}/`));
            return (
              <li key={tab.href} className={CELL}>
                <Link
                  href={tab.href}
                  aria-current={current ? "page" : undefined}
                  className={[ITEM, current ? "text-ink" : "text-ink-muted"].join(" ")}
                >
                  {tab.icon}
                  <span
                    className={
                      current ? "border-accent-ink border-b-2" : "border-b-2 border-transparent"
                    }
                  >
                    {tab.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
