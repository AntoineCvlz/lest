"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { authClient } from "@/shared/api/auth-client";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { describeDevice } from "@/shared/lib/user-agent";
import { Button } from "@/shared/ui/button";

import { UNAVAILABLE } from "../auth/errors";
import { FormAlert } from "../auth/form-alert";
import { DEVICE_SESSIONS_KEY } from "./query-keys";

export { DEVICE_SESSIONS_KEY };

const SESSIONS = "/api/v1/auth/app/v1/auth/sessions";
export const DEVICE_SIGNED_OUT = "Appareil déconnecté.";
export const OTHERS_SIGNED_OUT = "Les autres appareils sont déconnectés.";
export const SESSION_ENDED = "Votre session a pris fin. Reconnectez-vous pour gérer vos appareils.";
export const SESSIONS_UNAVAILABLE =
  "La liste des appareils n’a pas pu être chargée. Réessayez dans un instant.";

class SessionEnded extends Error {}

const CONNECTED_ON = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

interface Device {
  id: number;
  name: string;
  ip: string;
  createdAt: number;
  current: boolean;
}

/** Cet appareil d'abord, puis les plus récents. */
function useDevices() {
  return useQuery({
    queryKey: DEVICE_SESSIONS_KEY,
    retry: false,
    queryFn: async (): Promise<Device[]> => {
      const { data, response } = await authClient.GET(SESSIONS);
      if (!data) throw new Error(`Appareils indisponibles (${String(response.status)})`);
      return toDevices(data.data);
    },
  });
}

function toDevices(
  sessions: {
    id: number;
    user_agent: string;
    ip: string;
    created_at: number;
    is_current: boolean;
  }[],
): Device[] {
  return sessions
    .map((session) => ({
      id: session.id,
      name: describeDevice(session.user_agent),
      ip: session.ip,
      createdAt: session.created_at,
      current: session.is_current,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.createdAt - a.createdAt);
}

/**
 * Appareils où le compte est ouvert, et déconnexion à distance (allauth.usersessions). Fermer
 * une session révoque ses jetons ; la session courante n'est jamais proposée ici (« Se
 * déconnecter » reste sur l'accueil).
 */
export function DeviceSessions() {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const devices = useDevices();
  const [notice, setNotice] = useState<string | null>(null);
  const others = (devices.data ?? []).filter((device) => !device.current);

  const end = useMutation({
    mutationFn: async ({ ids }: { ids: number[]; notice: string }) => {
      const { data, response } = await authClient.DELETE(SESSIONS, { body: { sessions: ids } });
      // 401 : cette session-ci a pris fin entre-temps (fermée depuis un autre appareil).
      if (response.status === 401) throw new SessionEnded();
      if (!data || !("data" in data)) throw new Error("Déconnexion refusée");
      return toDevices(data.data);
    },
    onSuccess: (remaining, { notice }) => {
      queryClient.setQueryData(DEVICE_SESSIONS_KEY, remaining);
      setNotice(notice);
    },
    onError: (error) => {
      setNotice(null);
      // Session terminée : plus aucune donnée du compte en mémoire (le BFF a effacé les cookies).
      if (error instanceof SessionEnded) queryClient.clear();
      else void queryClient.invalidateQueries({ queryKey: DEVICE_SESSIONS_KEY });
    },
  });

  return (
    <section
      aria-labelledby="devices-title"
      className="border-line-subtle flex flex-col gap-4 border-t pt-8"
    >
      <h2 id="devices-title" className="text-xl font-extrabold [font-stretch:112%]">
        Appareils connectés
      </h2>
      <p className="text-ink-muted">
        Les appareils où votre compte est ouvert. Déconnectez ceux que vous ne reconnaissez pas,
        puis changez votre mot de passe.
      </p>
      {notice && (
        <p role="status" className="font-semibold">
          {notice}
        </p>
      )}
      <FormAlert
        messages={
          end.error instanceof SessionEnded ? [SESSION_ENDED] : end.isError ? [UNAVAILABLE] : []
        }
      />

      {devices.isPending && <p role="status">Chargement des appareils…</p>}
      {devices.isError && (
        <>
          <FormAlert messages={[SESSIONS_UNAVAILABLE]} />
          <Button
            variant="secondary"
            onClick={() => {
              void devices.refetch();
            }}
          >
            Réessayer
          </Button>
        </>
      )}

      {devices.data && (
        <ul aria-label="Appareils connectés" className="flex flex-col gap-2">
          {devices.data.map((device) => (
            <li
              key={device.id}
              className="bg-surface-raised rounded-control flex flex-wrap items-center justify-between gap-2 p-4"
            >
              <div className="min-w-0">
                <p className="font-semibold break-words">
                  {device.name}
                  {device.current && <span className="text-ink-muted"> (cet appareil)</span>}
                </p>
                <p className="text-ink-muted text-sm">
                  Connecté le {CONNECTED_ON.format(device.createdAt * 1000)}
                </p>
                <p className="text-ink-muted text-sm break-all">Adresse IP : {device.ip}</p>
              </div>
              {!device.current && (
                // Le nom accessible commence par le texte visible (WCAG 2.5.3).
                <Button
                  variant="ghost"
                  aria-label={`Déconnecter ${device.name}, connecté le ${CONNECTED_ON.format(device.createdAt * 1000)}`}
                  disabled={!hydrated || end.isPending}
                  onClick={() => {
                    end.mutate({ ids: [device.id], notice: DEVICE_SIGNED_OUT });
                  }}
                >
                  Déconnecter
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {others.length > 1 && (
        <Button
          variant="danger"
          disabled={!hydrated || end.isPending}
          onClick={() => {
            end.mutate({ ids: others.map((device) => device.id), notice: OTHERS_SIGNED_OUT });
          }}
        >
          Déconnecter les autres appareils
        </Button>
      )}
    </section>
  );
}
