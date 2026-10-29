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
 * Vrai si la réponse 401 d'allauth attend le parcours `flowId` (`verify_email`,
 * `mfa_authenticate`…). Un 401 peut en annoncer un autre : ne pas les confondre, sinon
 * l'utilisateur serait envoyé vers une saisie qui ne peut pas aboutir.
 */
export function awaitsFlow(body: unknown, flowId: string): boolean {
  return pendingFlow(body, flowId) !== undefined;
}

function pendingFlow(body: unknown, flowId: string): object | undefined {
  if (typeof body !== "object" || body === null || !("data" in body)) return undefined;
  const { data } = body;
  if (typeof data !== "object" || data === null || !("flows" in data)) return undefined;
  const { flows } = data;
  if (!Array.isArray(flows)) return undefined;
  return flows.find(
    (flow: unknown): flow is object =>
      typeof flow === "object" &&
      flow !== null &&
      "id" in flow &&
      flow.id === flowId &&
      "is_pending" in flow &&
      flow.is_pending === true,
  );
}

/**
 * Méthodes de second facteur du compte dont la connexion attend un second facteur (`totp`,
 * `recovery_codes`, `webauthn`), ou `null` s'il n'y a pas de connexion en attente.
 */
export function pendingSecondFactorTypes(body: unknown): string[] | null {
  const flow = pendingFlow(body, "mfa_authenticate");
  if (!flow) return null;
  const types = "types" in flow ? flow.types : undefined;
  return Array.isArray(types)
    ? types.filter((type: unknown): type is string => typeof type === "string")
    : [];
}

/**
 * 401 d'allauth sur une session valide (`meta.is_authenticated`) : l'action exige une
 * réauthentification récente, ce n'est pas un jeton expiré.
 */
export function requiresReauthentication(status: number, body: unknown): boolean {
  if (status !== 401 || typeof body !== "object" || body === null || !("meta" in body)) {
    return false;
  }
  const { meta } = body;
  return (
    typeof meta === "object" &&
    meta !== null &&
    "is_authenticated" in meta &&
    meta.is_authenticated === true
  );
}

export function awaitsEmailVerification(body: unknown): boolean {
  return awaitsFlow(body, "verify_email");
}
