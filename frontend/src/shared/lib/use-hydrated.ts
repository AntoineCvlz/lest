import { useSyncExternalStore } from "react";

function subscribe(): () => void {
  return () => undefined;
}

/**
 * `false` au rendu serveur et avant l'hydratation, `true` ensuite.
 *
 * Sert à désactiver un formulaire tant que React ne gère pas son envoi : sinon le navigateur
 * l'enverrait lui-même (identifiants dans l'URL d'un GET, ou dans un POST non prévu).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
