import { z } from "zod";

/**
 * Cérémonies WebAuthn du navigateur, entre les options JSON d'allauth (champs binaires en
 * base64url) et les réponses JSON qu'il attend. La conversion est faite ici plutôt qu'avec
 * `PublicKeyCredential.parseCreationOptionsFromJSON()` et `toJSON()`, absents de navigateurs
 * encore courants : un seul chemin, testé.
 */

export const PASSKEY_CANCELLED =
  "Passkey non utilisée : l’opération a été annulée ou a expiré. Réessayez.";
export const PASSKEY_ALREADY_ADDED = "Cette passkey est déjà enregistrée sur votre compte.";
export const PASSKEY_FAILED = "Votre appareil n’a pas pu utiliser de passkey. Réessayez.";

/** Vrai si le navigateur sait créer et utiliser des passkeys (contexte sécurisé compris). */
export function passkeysSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential === "function" &&
    "credentials" in navigator
  );
}

function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function toBase64Url(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const userVerification = z.enum(["required", "preferred", "discouraged"]).optional();
const descriptor = z.object({
  id: z.string(),
  type: z.literal("public-key"),
  transports: z.array(z.string()).optional(),
});
const descriptors = z.array(descriptor).optional();

const creationSchema = z.object({
  publicKey: z.object({
    challenge: z.string(),
    rp: z.object({ id: z.string().optional(), name: z.string() }),
    user: z.object({ id: z.string(), name: z.string(), displayName: z.string() }),
    pubKeyCredParams: z.array(z.object({ type: z.literal("public-key"), alg: z.number() })),
    timeout: z.number().optional(),
    excludeCredentials: descriptors,
    authenticatorSelection: z
      .object({
        authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
        residentKey: z.enum(["required", "preferred", "discouraged"]).optional(),
        requireResidentKey: z.boolean().optional(),
        userVerification,
      })
      .optional(),
    attestation: z.enum(["none", "indirect", "direct", "enterprise"]).optional(),
    extensions: z.object({ credProps: z.boolean().optional() }).optional(),
  }),
});

const requestSchema = z.object({
  publicKey: z.object({
    challenge: z.string(),
    rpId: z.string().optional(),
    timeout: z.number().optional(),
    allowCredentials: descriptors,
    userVerification,
  }),
});

function toDescriptors(list: z.infer<typeof descriptors>): PublicKeyCredentialDescriptor[] {
  return (list ?? []).map(({ id, type, transports }) => ({
    id: fromBase64Url(id),
    type,
    // Valeurs inconnues de ce navigateur : il les ignore (spécification WebAuthn).
    ...(transports && { transports: transports as AuthenticatorTransport[] }),
  }));
}

/** Échec d'une cérémonie, avec le message à afficher. */
export class PasskeyError extends Error {}

function passkeyError(error: unknown, ceremony: "create" | "get"): PasskeyError {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "AbortError") {
    return new PasskeyError(PASSKEY_CANCELLED);
  }
  // `excludeCredentials` : l'appareil porte déjà une passkey de ce compte.
  if (ceremony === "create" && name === "InvalidStateError") {
    return new PasskeyError(PASSKEY_ALREADY_ADDED);
  }
  return new PasskeyError(PASSKEY_FAILED);
}

/** Crée une passkey à partir des options d'allauth ; renvoie la réponse JSON à lui envoyer. */
export async function createPasskey(options: unknown): Promise<Record<string, unknown>> {
  const parsed = creationSchema.safeParse(options);
  if (!parsed.success) throw new PasskeyError(PASSKEY_FAILED);
  const { publicKey } = parsed.data;
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        ...publicKey,
        challenge: fromBase64Url(publicKey.challenge),
        user: { ...publicKey.user, id: fromBase64Url(publicKey.user.id) },
        excludeCredentials: toDescriptors(publicKey.excludeCredentials),
      },
    });
  } catch (error) {
    throw passkeyError(error, "create");
  }
  if (
    !(credential instanceof PublicKeyCredential) ||
    !(credential.response instanceof AuthenticatorAttestationResponse)
  ) {
    throw new PasskeyError(PASSKEY_FAILED);
  }
  const { response } = credential;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      transports: response.getTransports(),
    },
  };
}

/** Utilise une passkey pour les options d'allauth ; renvoie l'assertion JSON à lui envoyer. */
export async function getPasskey(options: unknown): Promise<Record<string, unknown>> {
  const parsed = requestSchema.safeParse(options);
  if (!parsed.success) throw new PasskeyError(PASSKEY_FAILED);
  const { publicKey } = parsed.data;
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        ...publicKey,
        challenge: fromBase64Url(publicKey.challenge),
        allowCredentials: toDescriptors(publicKey.allowCredentials),
      },
    });
  } catch (error) {
    throw passkeyError(error, "get");
  }
  if (
    !(credential instanceof PublicKeyCredential) ||
    !(credential.response instanceof AuthenticatorAssertionResponse)
  ) {
    throw new PasskeyError(PASSKEY_FAILED);
  }
  const { response } = credential;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      userHandle: response.userHandle ? toBase64Url(response.userHandle) : null,
    },
  };
}
