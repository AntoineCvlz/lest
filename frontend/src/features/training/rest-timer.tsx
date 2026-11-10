import { useId } from "react";

import { Button } from "@/shared/ui/button";

import { useRestNotification } from "./rest-notification";
import type { RestTimer as Timer } from "./use-rest-timer";

export const REST_OVER = "Repos terminé.";
export const NOTIFY_DENIED =
  "Notifications refusées pour Lest : autorisez-les dans les réglages du navigateur pour être prévenu.";
const STEP_SECONDS = 15;

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Repos en cours : temps restant, ±15 s, « Passer ». Le décompte n'est pas lu seconde par
 * seconde (`role="timer"`, sans annonce) ; seule la fin du repos est annoncée.
 */
export function RestTimer({ timer }: { timer: Timer }) {
  const labelId = useId();
  return (
    <>
      <p role="status" className="font-semibold empty:hidden">
        {timer.finished ? REST_OVER : ""}
      </p>
      {timer.remaining !== null && (
        <div className="rounded-control bg-surface-raised flex items-center gap-2 p-2">
          <div className="flex min-w-0 flex-1 flex-col px-2">
            <span id={labelId} className="text-ink-muted text-sm">
              Repos
            </span>
            <span
              role="timer"
              aria-labelledby={labelId}
              className="text-[28px] leading-none font-extrabold [font-stretch:112%] [font-variant-numeric:tabular-nums]"
            >
              {clock(timer.remaining)}
            </span>
          </div>
          <Button
            aria-label={`−${String(STEP_SECONDS)} s de repos`}
            onClick={() => {
              timer.adjust(-STEP_SECONDS);
            }}
          >
            −{STEP_SECONDS} s
          </Button>
          <Button
            aria-label={`+${String(STEP_SECONDS)} s de repos`}
            onClick={() => {
              timer.adjust(STEP_SECONDS);
            }}
          >
            +{STEP_SECONDS} s
          </Button>
          <Button variant="ghost" onClick={timer.stop}>
            Passer
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Activation de la notification de fin de repos, sur cet appareil. La permission du navigateur
 * n'est demandée qu'à cet appui (ADR 0015). Absente si le navigateur ne sait pas notifier.
 * Hors du bloc collé au bas de l'écran pendant la saisie : il masquerait la charge.
 */
export function RestNotificationToggle() {
  const inputId = useId();
  const hintId = useId();
  const { state, enable, disable } = useRestNotification();
  if (state === "unsupported") return null;
  if (state === "denied") return <p className="text-ink-muted text-sm">{NOTIFY_DENIED}</p>;
  return (
    <div className="flex min-h-11 items-center gap-3">
      <input
        id={inputId}
        type="checkbox"
        className="accent-accent size-6 shrink-0"
        checked={state === "on"}
        aria-describedby={hintId}
        onChange={(event) => {
          if (event.target.checked) void enable();
          else disable();
        }}
      />
      <div className="flex flex-col">
        <label htmlFor={inputId} className="font-semibold">
          Me prévenir à la fin du repos
        </label>
        <span id={hintId} className="text-ink-muted text-sm">
          Quand l’app est en arrière-plan, sur cet appareil.
        </span>
      </div>
    </div>
  );
}
