import { QueryClient } from "@tanstack/react-query";

import { WorkoutRequestFailed } from "@/features/training/use-workout";

import {
  accountHeaders,
  assertStillQueued,
  DroppedWrite,
  dropQueuedWrites,
  isRetryable,
  QUEUED_KEY,
  queuedWrite,
} from "./queue";

describe("isRetryable", () => {
  it.each([
    ["réseau coupé", new TypeError("Failed to fetch")],
    ["session expirée", new WorkoutRequestFailed(401)],
    ["délai dépassé", new WorkoutRequestFailed(408)],
    ["limite de débit", new WorkoutRequestFailed(429)],
    ["panne du serveur", new WorkoutRequestFailed(503)],
  ])("garde la saisie en file : %s", (_case, error) => {
    expect(isRetryable(error)).toBe(true);
  });

  it.each([
    ["refus de validation", new WorkoutRequestFailed(422)],
    ["parent inconnu", new WorkoutRequestFailed(404)],
    ["autre compte", new WorkoutRequestFailed(409)],
    ["erreur sans statut", new Error("bug")],
  ])("retire la saisie : %s", (_case, error) => {
    expect(isRetryable(error)).toBe(false);
  });
});

describe("queuedWrite", () => {
  it("attend de plus en plus longtemps entre deux essais, 30 s au plus", () => {
    const { retryDelay } = queuedWrite("refusée");

    expect([0, 1, 2, 10].map(retryDelay)).toEqual([1000, 2000, 4000, 30_000]);
  });
});

describe("accountHeaders", () => {
  it("nomme le compte de la saisie, ou rien s'il est inconnu", () => {
    expect(accountHeaders("compte-a")).toEqual({ "X-Lest-Account": "compte-a" });
    expect(accountHeaders(null)).toBeUndefined();
  });
});

describe("dropQueuedWrites", () => {
  it("retire les saisies en file, pas les autres mutations", () => {
    const queryClient = new QueryClient();
    const cache = queryClient.getMutationCache();
    cache.build(queryClient, { mutationKey: [...QUEUED_KEY, "training", "save-set"] });
    cache.build(queryClient, { mutationKey: ["profile", "save"] });

    dropQueuedWrites(queryClient);

    expect(cache.getAll().map((mutation) => mutation.options.mutationKey)).toEqual([
      ["profile", "save"],
    ]);
  });
});

describe("assertStillQueued", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("n'envoie plus une saisie retirée de la file pendant ses nouveaux essais", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const key = [...QUEUED_KEY, "essai"];
    const sent = vi.fn();
    queryClient.setMutationDefaults(key, {
      ...queuedWrite("refusée"),
      mutationFn: (variables: unknown) => {
        assertStillQueued(queryClient, variables);
        sent();
        return Promise.reject(new WorkoutRequestFailed(503));
      },
    });
    const done = queryClient
      .getMutationCache()
      .build(queryClient, { mutationKey: key })
      .execute({ id: "série" })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveBeenCalledOnce();

    dropQueuedWrites(queryClient);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await done).toBeInstanceOf(DroppedWrite);
    expect(sent).toHaveBeenCalledOnce();
  });
});
