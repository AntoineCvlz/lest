"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { href: "/corps", label: "Poids" },
  { href: "/corps/mensurations", label: "Mensurations" },
] as const;

/** Sous-navigation de Corps : la section courante porte `aria-current` (pas la couleur seule). */
export function BodyNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections de Corps">
      <ul className="flex gap-2">
        {SECTIONS.map((section) => {
          const current = pathname === section.href;
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={current ? "page" : undefined}
                className={[
                  "rounded-control flex min-h-11 items-center border px-4 font-bold",
                  current ? "bg-ink text-ground border-ink" : "border-line bg-surface text-ink",
                ].join(" ")}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
