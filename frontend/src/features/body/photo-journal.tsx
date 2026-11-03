"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import type { Schemas } from "@/shared/api/client";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { ChoiceGroup } from "@/shared/ui/choice-group";
import { SelectField } from "@/shared/ui/select-field";
import { TextField } from "@/shared/ui/text-field";

import { localDay, longDay, shortDay } from "./days";
import {
  MAX_PHOTO_BYTES,
  PHOTO_TYPES,
  PhotoRequestFailed,
  photoSrc,
  type Pose,
  POSES,
  useDeletePhoto,
  usePhotos,
  useUploadPhoto,
} from "./use-photos";

type Photo = Schemas["PhotoOut"];

export const PHOTOS_UNAVAILABLE = "Photos indisponibles pour le moment.";
export const PHOTO_NOT_SENT = "Photo non envoyée. Vérifiez la connexion, puis réessayez.";
export const PHOTO_REFUSED = "Photo refusée : choisissez une image JPEG, PNG ou WebP lisible.";
export const PHOTO_TOO_MANY = "Trop d’envois pour le moment : réessayez dans une heure.";
export const PHOTO_NOT_DELETED = "Photo non supprimée. Réessayez dans un instant.";
export const NO_PHOTO =
  "Aucune photo pour l’instant. Même lumière, même tenue, même distance : la comparaison sera parlante.";
export const PRIVACY =
  "Vos photos sont chiffrées et visibles par vous seul. Leurs métadonnées (position GPS, appareil) sont retirées à l’envoi.";

const EARLIEST = "2000-01-01";

function poseLabel(pose: Pose): string {
  return POSES.find((p) => p.value === pose)?.label ?? pose;
}

/** « Face, 3 novembre 2026 » : texte de remplacement d'une photo. */
export function photoAlt(photo: Photo): string {
  return `${poseLabel(photo.pose)}, ${longDay(photo.date)}`;
}

/** Erreur à afficher pour un fichier choisi, ou `null` s'il peut partir. */
export function fileProblem(file: File): string | null {
  if (!PHOTO_TYPES.some((type) => type === file.type)) {
    return "Choisissez une photo JPEG, PNG ou WebP.";
  }
  if (file.size > MAX_PHOTO_BYTES) return "Photo trop lourde : 15 Mo au plus.";
  return null;
}

function sendError(error: unknown): string {
  if (error instanceof PhotoRequestFailed) {
    if (error.status === 422 || error.status === 413 || error.status === 415) return PHOTO_REFUSED;
    if (error.status === 429) return PHOTO_TOO_MANY;
  }
  return PHOTO_NOT_SENT;
}

/**
 * Photos de progression : envoi (pose, date, fichier avec aperçu local), comparaison avant /
 * après d'une même pose, galerie avec suppression confirmée. Les images passent par l'API
 * (session, jamais en cache, ADR 0008) ; l'aperçu reste dans le navigateur (`blob:`).
 */
export function PhotoJournal() {
  const hydrated = useHydrated();
  const photos = usePhotos();
  const upload = useUploadPhoto();
  const remove = useDeletePhoto();
  const today = localDay();
  const [pose, setPose] = useState<Pose>("front");
  const [day, setDay] = useState(today);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [comparedPose, setComparedPose] = useState<Pose>("front");
  const [before, setBefore] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Aperçu local du fichier choisi, libéré quand il change.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const all = photos.data ?? [];
  const ofPose = all.filter((p) => p.pose === comparedPose);
  const first = ofPose.find((p) => p.id === before) ?? ofPose[0];
  const last = ofPose.find((p) => p.id === after) ?? ofPose.at(-1);
  const newestFirst = all.toReversed();

  function focus(selector: string) {
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-10">
      <form
        method="post"
        noValidate
        aria-labelledby="photo-title"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (upload.isPending) return;
          upload.reset();
          setNotice("");
          if (!file) {
            flushSync(() => {
              setFileError("Choisissez une photo.");
            });
            inputRef.current?.focus();
            return;
          }
          if (day < EARLIEST || day > today) {
            focus("input[name=day]");
            return;
          }
          upload.mutate(
            { file, day, pose },
            {
              onSuccess: () => {
                setFile(null);
                if (inputRef.current) inputRef.current.value = "";
                setNotice(
                  `Photo (${poseLabel(pose).toLowerCase()}) du ${longDay(day)} enregistrée.`,
                );
              },
            },
          );
        }}
      >
        <h2 id="photo-title" className="text-xl font-extrabold [font-stretch:112%]">
          Nouvelle photo
        </h2>
        <p className="text-ink-muted text-sm">{PRIVACY}</p>
        <ChoiceGroup legend="Pose" options={POSES} value={pose} onChange={setPose} layout="row" />
        <TextField
          label="Date"
          name="day"
          type="date"
          min={EARLIEST}
          max={today}
          value={day}
          onChange={(event) => {
            if (event.target.value) setDay(event.target.value);
          }}
        />
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            id="photo-file"
            type="file"
            accept={PHOTO_TYPES.join(",")}
            className="peer sr-only"
            aria-describedby={fileError ? "photo-file-error" : undefined}
            aria-invalid={fileError ? true : undefined}
            onChange={(event) => {
              const chosen = event.target.files?.[0] ?? null;
              const problem = chosen ? fileProblem(chosen) : null;
              setFileError(problem);
              setFile(problem ? null : chosen);
              setNotice("");
            }}
          />
          <label
            htmlFor="photo-file"
            className="rounded-control border-line bg-surface text-ink peer-focus-visible:outline-accent flex min-h-14 cursor-pointer items-center justify-center border px-4 font-bold peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2"
          >
            {file ? "Choisir une autre photo" : "Choisir une photo"}
          </label>
          {fileError && (
            <p id="photo-file-error" className="text-danger text-sm font-semibold">
              {fileError}
            </p>
          )}
          {preview && (
            // `<picture>`/`<img>`, jamais `next/image` : son style en ligne est refusé par la CSP.
            <picture>
              <img
                src={preview}
                alt="Aperçu avant envoi"
                className="rounded-control border-line-subtle aspect-[3/4] w-40 border object-cover"
              />
            </picture>
          )}
        </div>
        <div role="alert" className="empty:hidden">
          {upload.isError && (
            <p className="rounded-control border-danger text-danger border p-4 font-semibold">
              {sendError(upload.error)}
            </p>
          )}
        </div>
        <p aria-live="polite" className="text-ink-muted empty:sr-only">
          {notice}
        </p>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          disabled={!hydrated}
          aria-disabled={upload.isPending}
        >
          Envoyer la photo
        </Button>
      </form>

      <section
        aria-labelledby="compare-title"
        aria-busy={photos.isFetching}
        className="flex flex-col gap-5"
      >
        <h2 id="compare-title" className="text-xl font-extrabold [font-stretch:112%]">
          Comparer
        </h2>
        {photos.isPending && <p className="text-ink-muted">Chargement des photos…</p>}
        {photos.isError && (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="text-danger font-semibold">{PHOTOS_UNAVAILABLE}</p>
            <Button
              variant="secondary"
              onClick={() => {
                void photos.refetch();
              }}
            >
              Réessayer
            </Button>
          </div>
        )}
        {photos.isSuccess &&
          (all.length === 0 ? (
            <p className="text-ink-muted">{NO_PHOTO}</p>
          ) : (
            <>
              <ChoiceGroup
                legend="Pose comparée"
                options={POSES}
                value={comparedPose}
                onChange={(value) => {
                  setComparedPose(value);
                  setBefore(null);
                  setAfter(null);
                }}
                layout="row"
              />
              {ofPose.length < 2 || !first || !last ? (
                <p className="text-ink-muted">
                  {`Il faut au moins deux photos de ${poseLabel(comparedPose).toLowerCase()} pour comparer.`}
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <SelectField
                      label="Avant"
                      value={first.id}
                      onChange={(event) => {
                        setBefore(event.target.value);
                      }}
                    >
                      {ofPose.map((p) => (
                        <option key={p.id} value={p.id}>
                          {shortDay(p.date)}
                        </option>
                      ))}
                    </SelectField>
                    <SelectField
                      label="Après"
                      value={last.id}
                      onChange={(event) => {
                        setAfter(event.target.value);
                      }}
                    >
                      {ofPose.map((p) => (
                        <option key={p.id} value={p.id}>
                          {shortDay(p.date)}
                        </option>
                      ))}
                    </SelectField>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[first, last].map((photo, index) => (
                      <figure key={`${photo.id}-${String(index)}`} className="flex flex-col gap-2">
                        <picture>
                          <img
                            src={photoSrc(photo.id, "large")}
                            alt={photoAlt(photo)}
                            className="rounded-control bg-surface-raised aspect-[3/4] w-full object-contain"
                          />
                        </picture>
                        <figcaption className="text-ink-muted text-sm">
                          {`${index === 0 ? "Avant" : "Après"} : ${shortDay(photo.date)}`}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </>
              )}
            </>
          ))}
      </section>

      {photos.isSuccess && all.length > 0 && (
        <section aria-labelledby="gallery-title" className="flex flex-col gap-4">
          <h2 id="gallery-title" className="text-xl font-extrabold [font-stretch:112%]">
            Toutes les photos
          </h2>
          <div role="alert" className="empty:hidden">
            {remove.isError && <p className="text-danger font-semibold">{PHOTO_NOT_DELETED}</p>}
          </div>
          <ul
            aria-label="Photos, les plus récentes d’abord"
            className="grid grid-cols-2 gap-4 sm:grid-cols-3"
          >
            {newestFirst.map((photo) => (
              <li key={photo.id} className="flex flex-col gap-2">
                <picture>
                  <img
                    src={photoSrc(photo.id, "thumb")}
                    alt={photoAlt(photo)}
                    loading="lazy"
                    className="rounded-control bg-surface-raised aspect-[3/4] w-full object-cover"
                  />
                </picture>
                <span className="text-sm">{`${poseLabel(photo.pose)}, ${shortDay(photo.date)}`}</span>
                {confirming === photo.id ? (
                  <div className="flex flex-col gap-2">
                    <Button
                      variant="danger"
                      aria-disabled={remove.isPending}
                      onClick={() => {
                        if (remove.isPending) return;
                        remove.mutate(photo.id, {
                          onSuccess: () => {
                            flushSync(() => {
                              setConfirming(null);
                              setNotice(`Photo du ${longDay(photo.date)} supprimée.`);
                            });
                            focus("#gallery-title");
                          },
                        });
                      }}
                    >
                      Supprimer
                    </Button>
                    <Button
                      variant="secondary"
                      data-focus="keep"
                      onClick={() => {
                        flushSync(() => {
                          setConfirming(null);
                        });
                        focus(`[data-photo="${photo.id}"]`);
                      }}
                    >
                      Garder
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    data-photo={photo.id}
                    aria-label={`Supprimer la photo ${photoAlt(photo)}`}
                    onClick={() => {
                      flushSync(() => {
                        remove.reset();
                        setConfirming(photo.id);
                      });
                      focus("[data-focus=keep]");
                    }}
                  >
                    Supprimer
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
