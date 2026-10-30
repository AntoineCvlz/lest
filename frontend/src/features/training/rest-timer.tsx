import { useId } from "react";

import { Button } from "@/shared/ui/button";

import type { RestTimer as Timer } from "./use-rest-timer";

export const REST_OVER = "Repos terminé.";
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
