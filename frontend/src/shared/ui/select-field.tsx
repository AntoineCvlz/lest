import { useId, type SelectHTMLAttributes } from "react";

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  /** Libellé visible, toujours affiché. */
  label: string;
  /** Aide sous la liste, reliée par `aria-describedby` (ex. détail de l'option choisie). */
  hint?: string;
}

/**
 * Liste déroulante native « Fonte calibrée » : 56 px de haut, libellé au-dessus. Native pour
 * garder le sélecteur du système sur mobile (grand, au clavier, lu par les lecteurs d'écran).
 */
export function SelectField({ label, hint, className, children, ...props }: SelectFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-aide` : undefined;

  return (
    <div className={["flex min-w-0 flex-col gap-2", className ?? ""].filter(Boolean).join(" ")}>
      <label htmlFor={id} className="text-ink font-semibold">
        {label}
      </label>
      <select
        id={id}
        aria-describedby={hintId}
        className={[
          "rounded-control bg-surface text-ink border-line min-h-14 w-full border px-3",
          "text-[17px] disabled:cursor-not-allowed disabled:opacity-50",
        ].join(" ")}
        {...props}
      >
        {children}
      </select>
      {hint && (
        <p id={hintId} className="text-ink-muted text-sm">
          {hint}
        </p>
      )}
    </div>
  );
}
