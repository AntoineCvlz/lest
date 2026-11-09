import type { Mutation, QueryClient } from "@tanstack/react-query";

declare module "@tanstack/react-query" {
  interface Register {
    /** `refused` : message affiché si le serveur refuse la saisie (retirée de la file). */
    mutationMeta: { refused?: string };
  }
}

/**
 * File des saisies hors ligne (ADR 0015) : des mutations de TanStack Query sous la clé
 * `QUEUED_KEY`, déclarées par `setMutationDefaults` (leur fonction est retrouvée par la clé après
 * un rechargement), exécutées une par une dans l'ordre de saisie (portée commune).
 */
export const QUEUED_KEY = ["queued"] as const;
const QUEUE_SCOPE = { id: "lest-writes" };

/** Compte de la saisie : Django refuse (409) de l'écrire si un autre compte est connecté. */
const ACCOUNT_HEADER = "X-Lest-Account";
const ACCOUNT_MISMATCH = 409;
const MAX_RETRY_DELAY = 30_000;

/** Statut HTTP porté par l'erreur d'une saisie, s'il y en a un. */
export function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}

/**
 * Vrai si la saisie doit rester en file : réseau coupé (`TypeError` de `fetch`), délai dépassé,
 * limite de débit, panne du serveur, ou session expirée (gardée jusqu'à la reconnexion). Un autre
 * refus (422, 404, 409…) est définitif : la saisie est retirée.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const status = statusOf(error);
  if (status === undefined) return false;
  return status === 401 || status === 408 || status === 429 || status >= 500;
}

/** Options communes des saisies en file, à étaler dans leurs `setMutationDefaults`. */
export function queuedWrite(refused: string) {
  return {
    scope: QUEUE_SCOPE,
    networkMode: "online" as const,
    retry: (_failures: number, error: unknown) => isRetryable(error),
    retryDelay: (failures: number) => Math.min(1000 * 2 ** failures, MAX_RETRY_DELAY),
    meta: { refused },
  };
}

/** En-têtes d'une saisie faite pour `account`. */
export function accountHeaders(account: string | null): Record<string, string> | undefined {
  return account ? { [ACCOUNT_HEADER]: account } : undefined;
}

/** Saisie refusée parce qu'elle a été faite avec un autre compte : retirée sans rien dire. */
export function isAccountMismatch(error: unknown): boolean {
  return statusOf(error) === ACCOUNT_MISMATCH;
}

/**
 * Vrai pendant le `onSettled` de la dernière saisie en file : le moment de relire l'état du
 * serveur. Relire plus tôt effacerait l'affichage optimiste des saisies encore en attente.
 */
export function isLastQueuedWrite(queryClient: QueryClient): boolean {
  return queryClient.isMutating({ mutationKey: QUEUED_KEY }) <= 1;
}

function queued(queryClient: QueryClient, status?: "pending"): Mutation[] {
  return queryClient.getMutationCache().findAll({ mutationKey: QUEUED_KEY, status });
}

/**
 * Reprend les saisies en file. Une saisie restaurée pendant un envoi (app fermée en plein appel)
 * est « en cours » sans être en pause : TanStack ne la reprendrait pas seul.
 */
export async function resumeQueuedWrites(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    queued(queryClient, "pending").map((mutation) => mutation.continue().catch(() => undefined)),
  );
}

/** Vrai si `key` est la clé de saisie `expected`. */
export function isWrite(key: readonly unknown[], expected: readonly string[]): boolean {
  return key.length === expected.length && expected.every((part, index) => key[index] === part);
}

/** Saisies en attente, dans l'ordre de saisie, avec leur clé et leurs variables. */
export function pendingWrites(
  queryClient: QueryClient,
): { key: readonly unknown[]; variables: unknown }[] {
  return queued(queryClient, "pending").map((mutation) => ({
    key: mutation.options.mutationKey ?? [],
    variables: mutation.state.variables,
  }));
}

/** Saisie retirée de la file pendant ses essais (abandon, autre compte, autre onglet). */
export class DroppedWrite extends Error {
  constructor() {
    super("Saisie retirée de la file");
  }
}

/**
 * À appeler au début de chaque envoi : retirer une mutation du cache n'arrête pas ses nouveaux
 * essais déjà programmés. Une saisie abandonnée ne doit jamais partir (erreur non rejouable).
 */
export function assertStillQueued(queryClient: QueryClient, variables: unknown): void {
  const queued = queryClient
    .getMutationCache()
    .findAll({ mutationKey: QUEUED_KEY })
    .some((mutation) => mutation.state.variables === variables);
  if (!queued) throw new DroppedWrite();
}

/** Retire les saisies en file sans les envoyer (autre compte, abandon). */
export function dropQueuedWrites(queryClient: QueryClient): void {
  const cache = queryClient.getMutationCache();
  for (const mutation of queued(queryClient)) cache.remove(mutation);
}
