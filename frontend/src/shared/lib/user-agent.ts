/**
 * Libellé court d'un appareil (« Chrome sur Windows ») à partir de son user agent, pour qu'une
 * personne reconnaisse ses sessions. Indicatif : un user agent est déclaratif, et l'ordre des
 * tests compte (Edge et Opera se disent aussi Chrome, Chrome se dit aussi Safari).
 */

const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

function first(list: [RegExp, string][], userAgent: string): string | undefined {
  return list.find(([pattern]) => pattern.test(userAgent))?.[1];
}

export function describeDevice(userAgent: string): string {
  const browser = first(BROWSERS, userAgent);
  const system = first(SYSTEMS, userAgent);
  if (browser && system) return `${browser} sur ${system}`;
  return browser ?? system ?? "Appareil inconnu";
}
