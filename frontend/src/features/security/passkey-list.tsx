import { Button } from "@/shared/ui/button";

export interface Passkey {
  id: number;
  name: string;
  /** Horodatage epoch en secondes (allauth). */
  createdAt: number;
}

const ADDED_ON = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

interface PasskeyListProps {
  passkeys: Passkey[];
  /** Le navigateur sait créer une passkey (connu après l'hydratation). */
  supported: boolean;
  hydrated: boolean;
  notice: string | null;
  onAdd: () => void;
  onRemove: (passkey: Passkey) => void;
}

/** Passkeys du compte : connexion sans mot de passe, ou second facteur. */
export function PasskeyList({
  passkeys,
  supported,
  hydrated,
  notice,
  onAdd,
  onRemove,
}: PasskeyListProps) {
  return (
    <div className="flex flex-col gap-4 pt-4">
      <h3 className="text-lg font-bold [font-stretch:112%]">Passkeys</h3>
      {notice && (
        <p role="status" className="font-semibold">
          {notice}
        </p>
      )}
      {passkeys.length === 0 ? (
        <p className="text-ink-muted">
          Connectez-vous sans mot de passe, avec l’empreinte, le visage ou le code de verrouillage
          de votre appareil.
        </p>
      ) : (
        <ul aria-label="Passkeys enregistrées" className="flex flex-col gap-2">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              className="bg-surface-raised rounded-control flex flex-wrap items-center justify-between gap-2 p-4"
            >
              <div className="min-w-0">
                <p className="font-semibold break-words">{passkey.name}</p>
                <p className="text-ink-muted text-sm">
                  Ajoutée le {ADDED_ON.format(passkey.createdAt * 1000)}
                </p>
              </div>
              {/* Le nom accessible commence par le texte visible (WCAG 2.5.3). */}
              <Button
                variant="ghost"
                aria-label={`Retirer la passkey ${passkey.name}`}
                onClick={() => {
                  onRemove(passkey);
                }}
              >
                Retirer
              </Button>
            </li>
          ))}
        </ul>
      )}
      {hydrated && !supported ? (
        <p className="text-ink-muted text-sm">
          Ce navigateur ne permet pas de créer de passkey. Ouvrez Lest dans un navigateur récent
          pour en ajouter une.
        </p>
      ) : (
        <Button variant="secondary" disabled={!hydrated} onClick={onAdd}>
          Ajouter une passkey
        </Button>
      )}
    </div>
  );
}
