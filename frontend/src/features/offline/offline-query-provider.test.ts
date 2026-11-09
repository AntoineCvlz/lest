import { QueryClient } from "@tanstack/react-query";

import { ProfileUnavailable, PROFILE_QUERY_KEY } from "@/features/profile/use-profile";

import { forgetOnSessionEnd } from "./offline-query-provider";
import { QUEUED_KEY } from "./queue";

const HEALTH = ["get", "/api/v1/health/", {}];

/** Copie restaurée au lancement : profil et une saisie en attente. */
function restored(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  forgetOnSessionEnd(queryClient);
  queryClient.setQueryData(PROFILE_QUERY_KEY, { unit_system: "metric" });
  queryClient.setQueryData(HEALTH, { status: "ok" });
  queryClient.getMutationCache().build(queryClient, { mutationKey: [...QUEUED_KEY, "set"] });
  return queryClient;
}

function refetchProfile(queryClient: QueryClient, error: Error): Promise<unknown> {
  return queryClient
    .query({ queryKey: PROFILE_QUERY_KEY, queryFn: () => Promise.reject(error), staleTime: 0 })
    .catch(() => undefined);
}

describe("forgetOnSessionEnd", () => {
  it("oublie la copie hors ligne quand la session a pris fin, pas les saisies en attente", async () => {
    const queryClient = restored();

    await refetchProfile(queryClient, new ProfileUnavailable(401));

    expect(queryClient.getQueryData(PROFILE_QUERY_KEY)).toBeUndefined();
    expect(queryClient.getQueryData(HEALTH)).toEqual({ status: "ok" });
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
  });

  it("garde la copie quand seul le réseau manque", async () => {
    const queryClient = restored();

    await refetchProfile(queryClient, new TypeError("Failed to fetch"));

    expect(queryClient.getQueryData(PROFILE_QUERY_KEY)).toEqual({ unit_system: "metric" });
  });
});
