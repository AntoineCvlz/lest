import { useId } from "react";

import { formatNumber, stepValue } from "@/shared/lib/number";

export interface StepperProps {
  /** Libellé visible, aussi nom accessible du groupe (« Charge »). */
  label: string;
  value: number;
  onChange: (value: number) => void;
  step: number;
  min?: number;
  max?: number;
  /** Unité affichée sous la valeur (« kilos », « répétitions »). */
  unit?: string;
  /**
   * Unité d'un pas, pour le nom accessible des boutons (« kilos », « répétition ») : le nom
   * reprend le texte visible (« −2,5 kilos »), ce qui permet de cliquer à la voix sur « +1 »
   * (WCAG 2.5.3, label-content-name-mismatch).
   */
  stepUnit: string;
  /** `lg` : valeur principale en séance (charge). `md` : valeur secondaire (répétitions). */
  size?: "md" | "lg";
}

const VALUE_SIZES = { md: "text-[40px]", lg: "text-[52px]" } as const;
const BUTTON_SIZES = { md: "h-14", lg: "h-16" } as const;

/**
 * Saisie d'une valeur par pas (±2,5 kg, ±1 rep), utilisable d'une main entre deux séries.
 * La valeur est annoncée aux lecteurs d'écran à chaque changement.
 */
export function Stepper({
  label,
  value,
  onChange,
  step,
  min,
  max,
  unit,
  stepUnit,
  size = "lg",
}: StepperProps) {
  const labelId = useId();
  const canDecrement = min === undefined || value > min;
  const canIncrement = max === undefined || value < max;
  const button = [
    "rounded-control border-line bg-surface text-ink border text-xl font-bold",
    "disabled:cursor-not-allowed disabled:opacity-50",
    BUTTON_SIZES[size],
  ].join(" ");
  const amount = formatNumber(step);
  const decrementText = `−${amount}`;
  const incrementText = `+${amount}`;

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2">
      <span id={labelId} className="text-ink-muted text-sm">
        {label}
      </span>
      <div className="grid grid-cols-[76px_minmax(0,1fr)_76px] items-center gap-2.5">
        <button
          type="button"
          className={button}
          aria-label={`${decrementText} ${stepUnit}`}
          disabled={!canDecrement}
          onClick={() => {
            onChange(stepValue(value, -1, { step, min, max }));
          }}
        >
          {decrementText}
        </button>
        <output aria-live="polite" className="text-center">
          <span
            className={`block leading-none font-extrabold [font-stretch:112%] ${VALUE_SIZES[size]}`}
          >
            {formatNumber(value)}
          </span>
          {unit && <span className="text-ink-muted mt-1 block text-sm">{unit}</span>}
        </output>
        <button
          type="button"
          className={button}
          aria-label={`${incrementText} ${stepUnit}`}
          disabled={!canIncrement}
          onClick={() => {
            onChange(stepValue(value, 1, { step, min, max }));
          }}
        >
          {incrementText}
        </button>
      </div>
    </div>
  );
}
