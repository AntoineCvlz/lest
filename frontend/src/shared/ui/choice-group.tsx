import { useId } from "react";

export interface Choice<T extends string | number> {
  value: T;
  label: string;
}

export interface ChoiceGroupProps<T extends string | number> {
  /** Question posée, nom accessible du groupe (« Effort ressenti (RPE) »). */
  legend: string;
  options: readonly Choice<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
}

/**
 * Choix unique parmi quelques options courtes (RPE), en segments de 48 px.
 * Boutons radio natifs mis en forme : flèches du clavier, annonce « 3 sur 5, coché »
 * et envoi de formulaire fonctionnent sans ARIA ajouté.
 */
export function ChoiceGroup<T extends string | number>({
  legend,
  options,
  value,
  onChange,
}: ChoiceGroupProps<T>) {
  const name = useId();

  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="text-ink-muted mb-2 p-0 text-sm">{legend}</legend>
      {/* Segments de largeur égale en flex : pas d'attribut style, refusé par la CSP en prod. */}
      <div className="flex gap-1.5">
        {options.map((option) => {
          const id = `${name}-${String(option.value)}`;
          return (
            <div key={option.value} className="min-w-0 flex-1">
              <input
                id={id}
                type="radio"
                name={name}
                className="peer sr-only"
                checked={option.value === value}
                onChange={() => {
                  onChange(option.value);
                }}
              />
              <label
                htmlFor={id}
                className={[
                  "rounded-control border-line bg-surface text-ink flex h-12 cursor-pointer",
                  "items-center justify-center border text-[17px] font-bold",
                  "peer-checked:border-ink peer-checked:bg-ink peer-checked:text-ground",
                  "peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2",
                  "peer-focus-visible:outline-[var(--lest-focus)] peer-focus-visible:outline-solid",
                ].join(" ")}
              >
                {option.label}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
