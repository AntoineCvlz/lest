import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchClient, type Schemas } from "@/shared/api/client";

import { localDay, shiftDay } from "./days";
import { BODY_KEY } from "./query-keys";

const PHOTOS_KEY = [...BODY_KEY, "photos"] as const;
/** Une année de photos (période maximale de l'API). */
const PHOTO_DAYS = 366;

export type Pose = Schemas["PhotoOut"]["pose"];
export type PhotoSize = "thumb" | "large";

export const POSES: readonly { value: Pose; label: string }[] = [
  { value: "front", label: "Face" },
  { value: "side", label: "Profil" },
  { value: "back", label: "Dos" },
];

/** Types acceptés par l'API ; HEIC exclu (les navigateurs mobiles envoient du JPEG). */
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** 15 Mo au plus (`apps.body.photos.MAX_UPLOAD_BYTES`). */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/** Réponse inattendue de l'API : le message ne reprend aucune donnée envoyée. */
export class PhotoRequestFailed extends Error {
  constructor(readonly status: number) {
    super(`Photos : réponse ${String(status)}`);
  }
}

/** Adresse de l'image, servie par l'API derrière le BFF (session, jamais en cache, ADR 0008). */
export function photoSrc(id: string, size: PhotoSize): string {
  return `/api/v1/progress-photos/${id}/${size}/`;
}

/** Photos de la dernière année, les plus anciennes d'abord. */
export function usePhotos() {
  return useQuery({
    queryKey: PHOTOS_KEY,
    queryFn: async (): Promise<Schemas["PhotoOut"][]> => {
      const end = localDay();
      const { data, response } = await fetchClient.GET("/api/v1/progress-photos/", {
        params: { query: { start: shiftDay(end, -(PHOTO_DAYS - 1)), end } },
      });
      if (!data) throw new PhotoRequestFailed(response.status);
      return data;
    },
    retry: false,
  });
}

/** Envoie une photo sous un UUID du client : l'envoi peut être rejoué sans doublon (ADR 0003). */
export function useUploadPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, day, pose }: { file: File; day: string; pose: Pose }) => {
      const { data, response } = await fetchClient.PUT("/api/v1/progress-photos/{photo_id}/", {
        params: { path: { photo_id: crypto.randomUUID() }, query: { date: day, pose } },
        // Le corps est l'image brute : le client typé décrit un binaire en `string`, le
        // sérialiseur envoie le fichier tel quel avec son type.
        body: "",
        bodySerializer: () => file,
        headers: { "Content-Type": file.type },
      });
      if (!data) throw new PhotoRequestFailed(response.status);
      return data;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: PHOTOS_KEY }),
  });
}

export function useDeletePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { response } = await fetchClient.DELETE("/api/v1/progress-photos/{photo_id}/", {
        params: { path: { photo_id: id } },
      });
      if (!response.ok) throw new PhotoRequestFailed(response.status);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: PHOTOS_KEY }),
  });
}
