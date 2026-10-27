import { useId, type InputHTMLAttributes } from "react";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  /** Libellé visible, toujours affiché (jamais remplacé par le `placeholder`). */
  label: string;
  /** Aide permanente sous le champ (format attendu…). */
  hint?: string;
  /** Message d'erreur : marque le champ invalide et lui est relié pour les lecteurs d'écran. */
  error?: string;
}

/** Champ de saisie « Fonte calibrée » : 56 px de haut, libellé au-dessus, erreur explicite. */
export function TextField({ label, hint, error, className, ...props }: TextFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-aide` : undefined;
  const errorId = error ? `${id}-erreur` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={["flex flex-col gap-2", className ?? ""].filter(Boolean).join(" ")}>
      <label htmlFor={id} className="text-ink font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={[
          "rounded-control bg-surface text-ink min-h-14 border px-4 text-[17px]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error ? "border-danger" : "border-line",
        ].join(" ")}
        {...props}
      />
      {hint && (
        <p id={hintId} className="text-ink-muted text-sm">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-danger text-sm font-semibold">
          {error}
        </p>
      )}
    </div>
  );
}
