import { useCallback, useSyncExternalStore } from "react";

/**
 * Notification de fin de repos (ADR 0015) : locale, sans serveur de push, seulement si
 * l'utilisateur l'a activée sur cet appareil et si l'app est en arrière-plan. Texte fixe, aucune
 * donnée de santé. La vibration et l'heure de fin à l'écran restent la référence.
 */
export const REST_NOTIFICATION_TITLE = "Repos terminé";
const TAG = "lest-rest";
const ICON = "/icons/icon-192.png";
// Préférence de cet appareil seulement (confort, pas une donnée à garder).
const PREFERENCE = "lest-rest-notification";

const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** Vrai si le navigateur sait afficher une notification depuis le service worker. */
export function restNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

function readPreference(): boolean {
  try {
    return localStorage.getItem(PREFERENCE) === "on";
  } catch {
    return false;
  }
}

function writePreference(on: boolean): void {
  try {
    if (on) localStorage.setItem(PREFERENCE, "on");
    else localStorage.removeItem(PREFERENCE);
  } catch {
    // Stockage refusé (navigation privée) : la préférence vaut pour la page seulement.
  }
}

export type RestNotificationState = "unsupported" | "off" | "on" | "denied";

/** État vu par l'écran : la permission du navigateur prime sur la préférence. */
export function restNotificationState(): RestNotificationState {
  if (!restNotificationsSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return Notification.permission === "granted" && readPreference() ? "on" : "off";
}

/** Prévient à la fin du repos si c'est activé et que l'app n'est pas à l'écran. */
export async function notifyRestOver(): Promise<void> {
  if (restNotificationState() !== "on" || document.visibilityState === "visible") return;
  const registration = await navigator.serviceWorker.ready;
  // Même étiquette : une seule notification à la fois, la précédente est remplacée.
  await registration.showNotification(REST_NOTIFICATION_TITLE, {
    tag: TAG,
    icon: ICON,
    lang: "fr",
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Activation au clic seulement : la permission n'est jamais demandée au chargement. */
export function useRestNotification() {
  const state = useSyncExternalStore(subscribe, restNotificationState, () => "unsupported");
  const enable = useCallback(async () => {
    if (!restNotificationsSupported()) return;
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    writePreference(permission === "granted");
    changed();
  }, []);
  const disable = useCallback(() => {
    writePreference(false);
    changed();
  }, []);
  return { state, enable, disable };
}
