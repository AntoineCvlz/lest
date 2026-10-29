/**
 * Erreurs d'allauth traduites pour l'écran : messages par champ, et messages généraux.
 *
 * allauth répond `{ status: 400, errors: [{ code, message, param? }] }`. Les codes connus ont
 * un texte propre à Lest ; sinon on garde le message d'allauth (déjà en français).
 */

export interface FormErrors {
  fields: Partial<Record<string, string>>;
  global: string[];
}

export const NO_ERRORS: FormErrors = { fields: {}, global: [] };

const MESSAGES: Record<string, string> = {
  email_password_mismatch: "Adresse e-mail ou mot de passe incorrect.",
  too_many_login_attempts: "Trop de tentatives de connexion. Réessayez dans quelques minutes.",
  required: "Ce champ est obligatoire.",
  invalid: "Saisissez une adresse e-mail valide.",
  incorrect_code: "Code incorrect ou expiré. Vérifiez-le ou demandez-en un nouveau.",
};

// Erreurs qui portent sur la combinaison (ou sur le compte), pas sur un champ précis : allauth
// les rattache au mot de passe, mais dire lequel des deux est faux renseignerait un attaquant.
const GLOBAL_CODES = new Set(["email_password_mismatch", "too_many_login_attempts"]);

export const UNAVAILABLE = "Le service ne répond pas pour le moment. Réessayez dans un instant.";
export const RATE_LIMITED = MESSAGES.too_many_login_attempts ?? UNAVAILABLE;

interface AllauthError {
  code?: unknown;
  message?: unknown;
  param?: unknown;
}

function isErrorList(value: unknown): value is AllauthError[] {
  return Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null);
}

/** Erreurs d'une réponse 400 d'allauth, ou un message général si le corps est inattendu. */
/** Code TOTP ou de secours refusé : un code d'application ne se « redemande » pas. */
export const SECOND_FACTOR_MESSAGES: Record<string, string> = {
  incorrect_code:
    "Code incorrect. Saisissez le code affiché par l’application, ou l’un de vos codes de secours.",
};

export function formErrors(body: unknown, messages: Record<string, string> = {}): FormErrors {
  const list = typeof body === "object" && body !== null && "errors" in body ? body.errors : null;
  if (!isErrorList(list) || list.length === 0) return { fields: {}, global: [UNAVAILABLE] };

  const result: FormErrors = { fields: {}, global: [] };
  for (const { code, message, param } of list) {
    const text =
      (typeof code === "string" ? (messages[code] ?? MESSAGES[code]) : undefined) ??
      (typeof message === "string" ? message : UNAVAILABLE);
    const isGlobal = typeof code === "string" && GLOBAL_CODES.has(code);
    const fieldError = typeof param === "string" && param !== "" && !isGlobal;
    if (fieldError) result.fields[param] ??= text;
    else if (!result.global.includes(text)) result.global.push(text);
  }
  return result;
}
