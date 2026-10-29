import { encode } from "uqr";

/** Chemin SVG des modules foncés : un carré 1×1 par module, en une seule `path`. */
function modulesPath(data: boolean[][]): string {
  return data
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${String(x)} ${String(y)}h1v1h-1z` : "")))
    .join("");
}

/**
 * QR code dessiné en SVG par React (pas de chaîne SVG injectée : CSP stricte, pas de
 * `dangerouslySetInnerHTML`). Toujours foncé sur clair, quel que soit le thème.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { data, size } = encode(value, { border: 2 });
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      className="bg-qr-light fill-qr-dark rounded-control h-48 w-48"
      shapeRendering="crispEdges"
    >
      <path d={modulesPath(data)} />
    </svg>
  );
}
