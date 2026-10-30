import { useCallback, useEffect, useState } from "react";

export const DEFAULT_REST_SECONDS = 120;
export const MIN_REST_SECONDS = 15;
export const MAX_REST_SECONDS = 600;
// Deux impulsions courtes : perceptible en poche, sans ressembler à un appel.
const END_VIBRATION = [200, 100, 200];

export interface RestTimer {
  /** Secondes restantes, `null` sans repos en cours. */
  remaining: number | null;
  /** Durée choisie, reprise au repos suivant. */
  duration: number;
  /** Vrai une fois le dernier repos arrivé à son terme (jusqu'au suivant). */
  finished: boolean;
  start: () => void;
  /** Allonge ou raccourcit le repos en cours et la durée des suivants. */
  adjust: (seconds: number) => void;
  stop: () => void;
}

function clamp(seconds: number): number {
  return Math.min(MAX_REST_SECONDS, Math.max(MIN_REST_SECONDS, seconds));
}

/**
 * Minuteur de repos entre deux séries. Il garde l'heure de fin, pas un compteur : un onglet
 * mis en veille (écran éteint, autre app) retrouve le bon temps restant au retour. Vibre à
 * la fin quand l'appareil le permet.
 */
export function useRestTimer(): RestTimer {
  const [duration, setDuration] = useState(DEFAULT_REST_SECONDS);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (endsAt === null) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= endsAt) {
        // Arrêt immédiat : d'autres ticks pourraient passer avant le rendu (double vibration).
        clearInterval(timer);
        setEndsAt(null);
        setFinished(true);
        // Absente de Safari sur iOS : la fin reste annoncée à l'écran.
        if ("vibrate" in navigator) navigator.vibrate(END_VIBRATION);
      }
    };
    const timer = setInterval(tick, 250);
    return () => {
      clearInterval(timer);
    };
  }, [endsAt]);

  const start = useCallback(() => {
    const current = Date.now();
    setNow(current);
    setFinished(false);
    setEndsAt(current + duration * 1000);
  }, [duration]);

  const adjust = useCallback((seconds: number) => {
    setDuration((value) => clamp(value + seconds));
    setEndsAt((value) => (value === null ? null : Math.max(Date.now(), value + seconds * 1000)));
  }, []);

  const stop = useCallback(() => {
    setEndsAt(null);
    setFinished(false);
  }, []);

  return {
    remaining: endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000)),
    duration,
    finished,
    start,
    adjust,
    stop,
  };
}
