"use client";

import { useMutationState } from "@tanstack/react-query";

import { isAccountMismatch, QUEUED_KEY, statusOf } from "./queue";

const REFUSED = "Saisie refusée par le serveur : elle n’a pas été enregistrée.";

function count(n: number): string {
  return n === 1 ? "1 saisie" : `${String(n)} saisies`;
}

/** Texte de l'état de la file, ou chaîne vide quand tout est envoyé. */
export function pendingText(pending: number, signedOut: boolean): string {
  if (pending === 0) return "";
  if (signedOut) return `${count(pending)} en attente : reconnectez-vous pour les envoyer.`;
  return `${count(pending)} en attente d’envoi, gardée${pending > 1 ? "s" : ""} sur cet appareil.`;
}

/**
 * Saisies en attente et saisies refusées par le serveur (ADR 0015). Les deux régions restent
 * dans le DOM pour que leurs changements soient annoncés.
 */
export function PendingWrites() {
  const failures = useMutationState({
    filters: { mutationKey: QUEUED_KEY, status: "pending" },
    select: (mutation) => statusOf(mutation.state.failureReason),
  });
  const refused = useMutationState({
    filters: { mutationKey: QUEUED_KEY, status: "error" },
    select: (mutation) => ({
      id: mutation.mutationId,
      message: mutation.meta?.refused ?? REFUSED,
      mismatch: isAccountMismatch(mutation.state.error),
    }),
  }).filter((one) => !one.mismatch);
  const signedOut = failures.some((status) => status === 401);

  return (
    <>
      <p role="status" className="text-ink-muted empty:hidden">
        {pendingText(failures.length, signedOut)}
      </p>
      <div role="alert" className="empty:hidden">
        {refused.map((one) => (
          <p
            key={one.id}
            className="rounded-control border-danger text-danger border p-4 font-semibold"
          >
            {one.message}
          </p>
        ))}
      </div>
    </>
  );
}
