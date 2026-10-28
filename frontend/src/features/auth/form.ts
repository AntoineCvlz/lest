import { NO_ERRORS, UNAVAILABLE, type FormErrors } from "./errors";

/** Issue d'un envoi de formulaire de compte : une étape suivante, ou un refus à afficher. */
export type Outcome<Next extends string> = { kind: Next } | { kind: "refused"; errors: FormErrors };

export function refused(...global: string[]): { kind: "refused"; errors: FormErrors } {
  return { kind: "refused", errors: { fields: {}, global } };
}

/** Erreurs à afficher pour une mutation : refus d'allauth, ou panne réseau. */
export function errorsOf<Next extends string>(
  data: Outcome<Next> | undefined,
  failed: boolean,
): FormErrors {
  if (data && "errors" in data) return data.errors;
  return failed ? { fields: {}, global: [UNAVAILABLE] } : NO_ERRORS;
}

export function textValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Vrai si la réponse 401 d'allauth attend la vérification de l'adresse e-mail.
 *
 * Un 401 peut annoncer un autre parcours (second facteur, passkey…) : ne pas les confondre,
 * sinon l'utilisateur serait envoyé vers une saisie de code qui ne peut pas aboutir.
 */
export function awaitsEmailVerification(body: unknown): boolean {
  if (typeof body !== "object" || body === null || !("data" in body)) return false;
  const { data } = body;
  if (typeof data !== "object" || data === null || !("flows" in data)) return false;
  const { flows } = data;
  return (
    Array.isArray(flows) &&
    flows.some(
      (flow: unknown) =>
        typeof flow === "object" &&
        flow !== null &&
        "id" in flow &&
        flow.id === "verify_email" &&
        "is_pending" in flow &&
        flow.is_pending === true,
    )
  );
}
