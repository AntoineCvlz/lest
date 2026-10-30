import { useEffect } from "react";

/**
 * Garde l'écran allumé tant que `active` est vrai (séance en cours). Le navigateur relâche le
 * verrou quand la page est masquée : il est redemandé à son retour. Sans prise en charge, ou
 * refusé (économie d'énergie), rien ne se passe : c'est un confort, pas une condition.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const request = async () => {
      if (document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (released) await lock.release();
        else sentinel = lock;
      } catch {
        // Refus du navigateur : l'écran s'éteindra comme d'habitude.
      }
    };
    const onVisible = () => {
      void request();
    };

    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release();
    };
  }, [active]);
}
