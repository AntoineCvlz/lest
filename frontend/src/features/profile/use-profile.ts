import { useQuery } from "@tanstack/react-query";

import { fetchClient, type Schemas } from "@/shared/api/client";

export const PROFILE_QUERY_KEY = ["profile"] as const;

/** Réponse inattendue de l'API (401 : session absente ou expirée). */
export class ProfileUnavailable extends Error {
  constructor(readonly status: number) {
    super(`Profil indisponible (${String(status)})`);
  }
}

/**
 * Profil du compte connecté : `null` tant que l'onboarding n'est pas fait (404), erreur
 * `ProfileUnavailable` pour toute autre réponse.
 */
export function useProfile(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: async (): Promise<Schemas["ProfileOut"] | null> => {
      const { data, response } = await fetchClient.GET("/api/v1/me/profile/");
      if (response.status === 404) return null;
      if (!data) throw new ProfileUnavailable(response.status);
      return data;
    },
    retry: false,
    enabled: options.enabled ?? true,
  });
}
