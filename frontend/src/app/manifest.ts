import type { MetadataRoute } from "next";

/**
 * Manifest de l'app installable (ADR 0015). Couleurs du thème sombre par défaut
 * (docs/design-system.md) ; aucune orientation imposée (WCAG 1.3.4).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Lest",
    short_name: "Lest",
    description: "Suivi de prise de masse, de musculation et de sport.",
    lang: "fr",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#1b242d",
    theme_color: "#1b242d",
    categories: ["health", "fitness", "sports"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
