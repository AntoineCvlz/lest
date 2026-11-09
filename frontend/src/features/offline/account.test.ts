import { QueryClient } from "@tanstack/react-query";

import { waitFor } from "@testing-library/react";

import { bindAccount, forgetAccount, listenForForget, loadStoredAccount } from "./account";
import { QUEUED_KEY } from "./queue";
import { readStoredAccount, releaseCopy, storeAccount, wipeOfflineStore } from "./storage";

vi.mock("./storage", () => ({
  readStoredAccount: vi.fn(),
  storeAccount: vi.fn(),
  wipeOfflineStore: vi.fn(),
  releaseCopy: vi.fn(),
}));
vi.mock("@/shared/pwa/service-worker", () => ({ clearCachedPages: vi.fn() }));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

/** Client avec une saisie de A en attente et sa séance en cache. */
function clientOfA(): QueryClient {
  const queryClient = new QueryClient();
  queryClient.getMutationCache().build(queryClient, { mutationKey: [...QUEUED_KEY, "set"] });
  queryClient.setQueryData(["workouts", "ongoing"], { id: "séance de A" });
  return queryClient;
}

beforeEach(async () => {
  vi.mocked(readStoredAccount).mockResolvedValue(A);
  // Compte connu en mémoire remis à zéro entre deux tests.
  await forgetAccount(new QueryClient());
  vi.clearAllMocks();
  vi.mocked(readStoredAccount).mockResolvedValue(A);
});

describe("bindAccount", () => {
  it("garde les saisies en attente du même compte", async () => {
    const queryClient = clientOfA();
    await loadStoredAccount();

    await bindAccount(queryClient, A);

    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
    expect(queryClient.getQueryData(["workouts", "ongoing"])).toEqual({ id: "séance de A" });
    expect(storeAccount).not.toHaveBeenCalled();
  });

  it("oublie sans les rejouer les saisies et les données d'un autre compte", async () => {
    const queryClient = clientOfA();
    await loadStoredAccount();

    await bindAccount(queryClient, B);

    expect(queryClient.getMutationCache().getAll()).toEqual([]);
    expect(queryClient.getQueryData(["workouts", "ongoing"])).toBeUndefined();
    expect(storeAccount).toHaveBeenCalledWith(B);
  });

  it("adopte le compte quand l'appareil n'en connaît aucun", async () => {
    vi.mocked(readStoredAccount).mockResolvedValue(undefined);
    const queryClient = clientOfA();

    await bindAccount(queryClient, A);

    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
    expect(storeAccount).toHaveBeenCalledWith(A);
  });
});

describe("forgetAccount", () => {
  it("efface la mémoire et la copie de l'appareil", async () => {
    const queryClient = clientOfA();

    await forgetAccount(queryClient);

    expect(queryClient.getMutationCache().getAll()).toEqual([]);
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
    expect(wipeOfflineStore).toHaveBeenCalledOnce();
  });

  it("fait tout oublier aux autres onglets, qui n'écrivent plus la copie", async () => {
    const otherTab = clientOfA();
    const stop = listenForForget(otherTab);
    try {
      await forgetAccount(new QueryClient());

      await waitFor(() => {
        expect(otherTab.getMutationCache().getAll()).toEqual([]);
      });
      expect(otherTab.getQueryCache().getAll()).toEqual([]);
      expect(releaseCopy).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });

  it("ne reçoit pas sa propre annonce : la session relue après la déconnexion reste", async () => {
    const queryClient = new QueryClient();
    const stop = listenForForget(queryClient);
    const otherTab = clientOfA();
    const stopOther = listenForForget(otherTab);
    try {
      await forgetAccount(queryClient);
      queryClient.setQueryData(["get", "/api/v1/me/", {}], null);

      await waitFor(() => {
        expect(otherTab.getQueryCache().getAll()).toEqual([]);
      });
      expect(queryClient.getQueryData(["get", "/api/v1/me/", {}])).toBeNull();
      expect(releaseCopy).toHaveBeenCalledTimes(2);
    } finally {
      stop();
      stopOther();
    }
  });
});
