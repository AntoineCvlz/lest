"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const ICON =
  "size-6 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]";

export const TABS: readonly { href: string; label: string; icon: ReactNode }[] = [
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
    href: "/exercices",
    label: "Exercices",
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={ICON}>
        <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
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

/** Onglets du bas, dans la zone du pouce (CLAUDE.md) : l'onglet courant porte `aria-current`. */
export function AppTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      className="border-line-subtle bg-ground fixed inset-x-0 bottom-0 border-t pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-2xl grid-cols-3">
        {TABS.map((tab) => {
          const current = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={[
                  "flex min-h-16 flex-col items-center justify-center gap-1 text-sm font-semibold",
                  current ? "text-ink" : "text-ink-muted",
                ].join(" ")}
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
  );
}
