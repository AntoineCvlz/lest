"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { useProfile } from "@/features/profile/use-profile";
import { localDay, longDay, shortDay } from "@/shared/lib/days";
import { formatNumber, parseDecimal } from "@/shared/lib/number";
import {
  DISTANCE_UNITS,
  distanceToMetres,
  metresToDistance,
  type UnitSystem,
} from "@/shared/lib/units";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";
import { SelectField } from "@/shared/ui/select-field";
import { TextField } from "@/shared/ui/text-field";

import {
  type Activity,
  JOURNAL_DAYS,
  type Sport,
  type SportKey,
  useActivities,
  useDeleteActivity,
  useSaveActivity,
  useSports,
} from "./use-activities";

export const ACTIVITIES_UNAVAILABLE = "Activités indisponibles pour le moment.";
export const ACTIVITY_NOT_SAVED =
  "Activité non enregistrée. Vérifiez les valeurs et la connexion, puis réessayez.";
export const ACTIVITY_NOT_DELETED = "Activité non supprimée. Réessayez dans un instant.";
export const NO_ACTIVITY =
  "Aucune activité sur les 30 derniers jours. Notez votre prochaine sortie, match ou séance.";

const EARLIEST = "2000-01-01";
const MAX_MINUTES = 24 * 60;
const MIN_HEART_RATE = 30;
const MAX_HEART_RATE = 230;
// Espace insécable : un nombre ne se sépare jamais de son unité.
const NBSP = " ";

export const FEELINGS = [
  { value: 1, label: "1 : très mauvais" },
  { value: 2, label: "2 : mauvais" },
  { value: 3, label: "3 : correct" },
  { value: 4, label: "4 : bon" },
  { value: 5, label: "5 : excellent" },
] as const;

type Field = "day" | "duration" | "distance" | "heartRate" | `metric-${string}`;

interface Draft {
  id: string;
  day: string;
  sport: SportKey;
  minutes: string;
  distance: string;
  heartRate: string;
  feeling: string;
  metrics: Record<string, string>;
}

function emptyDraft(today: string, sport: SportKey = "running"): Draft {
  return {
    id: crypto.randomUUID(),
    day: today,
    sport,
    minutes: "",
    distance: "",
    heartRate: "",
    feeling: "",
    metrics: {},
  };
}

function draftOf(activity: Activity, system: UnitSystem): Draft {
  return {
    id: activity.id,
    day: activity.date,
    sport: activity.sport,
    minutes: String(Math.round(activity.duration_s / 60)),
    distance:
      activity.distance_m === null
        ? ""
        : formatNumber(metresToDistance(activity.distance_m, system)),
    heartRate: activity.avg_heart_rate === null ? "" : String(activity.avg_heart_rate),
    feeling: activity.feeling === null ? "" : String(activity.feeling),
    metrics: Object.fromEntries(
      Object.entries(activity.metrics).map(([key, value]) => [key, String(value)]),
    ),
  };
}

/** « 1 h 05 », « 45 min » : une durée lisible. */
export function durationText(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}${NBSP}min`;
  const rest = minutes % 60;
  return `${String(Math.floor(minutes / 60))}${NBSP}h${NBSP}${String(rest).padStart(2, "0")}`;
}

/** « 45 min, 10,2 km, FC 148, ressenti 4 sur 5, dénivelé positif 120 m » : détail d'une activité. */
export function detailText(activity: Activity, sport: Sport | undefined, system: UnitSystem) {
  const parts = [durationText(activity.duration_s)];
  if (activity.distance_m !== null) {
    parts.push(
      `${formatNumber(metresToDistance(activity.distance_m, system))}${NBSP}${DISTANCE_UNITS[system].symbol}`,
    );
  }
  if (activity.avg_heart_rate !== null) {
    parts.push(`FC moyenne ${String(activity.avg_heart_rate)}${NBSP}bpm`);
  }
  if (activity.feeling !== null) parts.push(`ressenti ${String(activity.feeling)} sur 5`);
  for (const metric of sport?.metrics ?? []) {
    const value = activity.metrics[metric.key];
    if (value === undefined) continue;
    const unit = metric.unit ? `${NBSP}${metric.unit}` : "";
    parts.push(`${metric.label.toLowerCase()} ${formatNumber(value)}${unit}`);
  }
  return parts.join(", ");
}

/** Résumé des 30 jours : nombre d'activités et temps total. */
export function summaryText(activities: readonly Activity[]): string {
  const total = activities.reduce((sum, a) => sum + a.duration_s, 0);
  const count = activities.length;
  return `${String(count)} ${count > 1 ? "activités" : "activité"}, ${durationText(total)} au total.`;
}

/**
 * Autres sports (ADR 0012) : formulaire construit depuis le catalogue (un sport choisi, ses
 * champs apparaissent), puis les activités des 30 derniers jours, modifiables et supprimables.
 */
export function ActivityJournal() {
  const hydrated = useHydrated();
  const profile = useProfile();
  const system = profile.data?.unit_system ?? "metric";
  const distanceUnit = DISTANCE_UNITS[system];
  const sports = useSports();
  const activities = useActivities();
  const save = useSaveActivity();
  const remove = useDeleteActivity();
  const today = localDay();
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(today));
  // Activité en cours de modification (son bouton « Modifier » reprend le focus ensuite).
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId !== null;
  const [confirming, setConfirming] = useState(false);
  const [invalid, setInvalid] = useState<Field[]>([]);
  const [notice, setNotice] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const catalog = sports.data ?? [];
  // Premier sport du catalogue si celui du brouillon n'y est pas (catalogue changé côté serveur).
  const sport = catalog.find((s) => s.key === draft.sport) ?? catalog[0];
  const rows = (activities.data ?? []).toReversed();

  function focus(selector: string) {
    formRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }

  function focusRow(id: string) {
    listRef.current?.querySelector<HTMLElement>(`[data-activity="${id}"]`)?.focus();
  }

  /** « durée, FC moyenne » : champs à corriger, dans l'ordre du formulaire. */
  function faultNames(faults: readonly Field[]): string {
    return faults
      .map((fault) => {
        if (fault === "day") return "date";
        if (fault === "duration") return "durée";
        if (fault === "distance") return "distance";
        if (fault === "heartRate") return "FC moyenne";
        const key = fault.slice("metric-".length);
        return sport?.metrics.find((m) => m.key === key)?.label.toLowerCase() ?? key;
      })
      .join(", ");
  }

  function sportLabel(key: SportKey): string {
    return catalog.find((s) => s.key === key)?.label ?? "Activité";
  }

  function update(change: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...change }));
    setNotice("");
  }

  function reset(message: string) {
    flushSync(() => {
      setDraft(emptyDraft(today, sport?.key ?? draft.sport));
      setEditingId(null);
      setConfirming(false);
      setInvalid([]);
      setNotice(message);
    });
  }

  function startEdit(activity: Activity) {
    flushSync(() => {
      save.reset();
      remove.reset();
      setDraft(draftOf(activity, system));
      setEditingId(activity.id);
      setConfirming(false);
      setInvalid([]);
      setNotice(
        `Modification de l’activité : ${sportLabel(activity.sport).toLowerCase()}, ${longDay(activity.date)}.`,
      );
    });
    focus("select[name=sport]");
  }

  function submit() {
    if (save.isPending || !sport) return;
    save.reset();
    setNotice("");
    const faults: Field[] = [];
    if (!draft.day || draft.day < EARLIEST || draft.day > today) faults.push("day");
    const minutes = Number(draft.minutes.trim());
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) faults.push("duration");
    let distance: number | null = null;
    if (sport.has_distance && draft.distance.trim() !== "") {
      const value = parseDecimal(draft.distance);
      if (value === null || value < 0 || value > distanceUnit.max) faults.push("distance");
      else distance = distanceToMetres(value, system);
    }
    let heartRate: number | null = null;
    if (draft.heartRate.trim() !== "") {
      const value = Number(draft.heartRate.trim());
      if (!Number.isInteger(value) || value < MIN_HEART_RATE || value > MAX_HEART_RATE) {
        faults.push("heartRate");
      } else heartRate = value;
    }
    const metrics: Record<string, number> = {};
    for (const metric of sport.metrics) {
      const text = (draft.metrics[metric.key] ?? "").trim();
      if (text === "") continue;
      const value = Number(text);
      if (!Number.isInteger(value) || value < metric.min || value > metric.max) {
        faults.push(`metric-${metric.key}`);
      } else metrics[metric.key] = value;
    }
    flushSync(() => {
      setInvalid([]);
    });
    flushSync(() => {
      setInvalid(faults);
    });
    const [first] = faults;
    if (first) {
      focus(`input[name=${first}]`);
      return;
    }
    const label = sport.label;
    const day = draft.day;
    const wasEditing = editingId;
    save.mutate(
      {
        id: draft.id,
        body: {
          date: day,
          sport: sport.key,
          duration_s: minutes * 60,
          distance_m: distance,
          avg_heart_rate: heartRate,
          feeling: draft.feeling === "" ? null : Number(draft.feeling),
          metrics,
        },
      },
      {
        onSuccess: () => {
          reset(
            `Activité ${wasEditing ? "modifiée" : "enregistrée"} : ${label.toLowerCase()}, ${longDay(day)}.`,
          );
          // Après une modification, retour à la ligne d'où l'on venait.
          if (wasEditing) focusRow(wasEditing);
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {sports.isPending && <p className="text-ink-muted">Chargement des sports…</p>}
      {sports.isError && (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-danger font-semibold">{ACTIVITIES_UNAVAILABLE}</p>
          <Button
            variant="secondary"
            onClick={() => {
              void sports.refetch();
            }}
          >
            Réessayer
          </Button>
        </div>
      )}
      {sports.isSuccess && !sport && (
        <p className="text-ink-muted">Aucun sport disponible pour le moment.</p>
      )}
      {sport && (
        <form
          ref={formRef}
          method="post"
          noValidate
          aria-labelledby="activity-title"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <h2 id="activity-title" className="text-xl font-extrabold [font-stretch:112%]">
            {editing ? "Modifier l’activité" : "Noter une activité"}
          </h2>
          <SelectField
            label="Sport"
            name="sport"
            value={sport.key}
            hint="Les détails proposés dépendent du sport."
            onChange={(event) => {
              const chosen = catalog.find((s) => s.key === event.target.value);
              if (!chosen) return;
              update({ sport: chosen.key });
              // Les erreurs des champs propres à l'ancien sport ne valent plus.
              setInvalid((current) =>
                current.filter((f) => f !== "distance" && !f.startsWith("metric-")),
              );
            }}
          >
            {catalog.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Date"
            name="day"
            type="date"
            min={EARLIEST}
            max={today}
            value={draft.day}
            error={
              invalid.includes("day")
                ? "Choisissez une date entre le 1er janvier 2000 et aujourd’hui."
                : undefined
            }
            onChange={(event) => {
              update({ day: event.target.value });
            }}
          />
          <TextField
            label="Durée (min)"
            name="duration"
            inputMode="numeric"
            autoComplete="off"
            aria-required
            hint="En minutes entières."
            value={draft.minutes}
            error={
              invalid.includes("duration")
                ? `Nombre entier de 1 à ${formatNumber(MAX_MINUTES)}.`
                : undefined
            }
            onChange={(event) => {
              update({ minutes: event.target.value });
            }}
          />
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 font-semibold">Détails (facultatif)</legend>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(12rem,100%),1fr))] gap-3">
              {sport.has_distance && (
                <TextField
                  label={`Distance (${distanceUnit.symbol})`}
                  name="distance"
                  inputMode="decimal"
                  autoComplete="off"
                  value={draft.distance}
                  error={
                    invalid.includes("distance")
                      ? `Distance de 0 à ${formatNumber(distanceUnit.max)} ${distanceUnit.symbol}.`
                      : undefined
                  }
                  onChange={(event) => {
                    update({ distance: event.target.value });
                  }}
                />
              )}
              <TextField
                label="FC moyenne (bpm)"
                name="heartRate"
                inputMode="numeric"
                autoComplete="off"
                value={draft.heartRate}
                error={
                  invalid.includes("heartRate")
                    ? `Nombre entier de ${String(MIN_HEART_RATE)} à ${String(MAX_HEART_RATE)}.`
                    : undefined
                }
                onChange={(event) => {
                  update({ heartRate: event.target.value });
                }}
              />
              {sport.metrics.map((metric) => {
                const name: Field = `metric-${metric.key}`;
                return (
                  <TextField
                    key={metric.key}
                    label={metric.unit ? `${metric.label} (${metric.unit})` : metric.label}
                    name={name}
                    inputMode="numeric"
                    autoComplete="off"
                    value={draft.metrics[metric.key] ?? ""}
                    error={
                      invalid.includes(name)
                        ? `Nombre entier de ${formatNumber(metric.min)} à ${formatNumber(metric.max)}.`
                        : undefined
                    }
                    onChange={(event) => {
                      const text = event.target.value;
                      setDraft((current) => ({
                        ...current,
                        metrics: { ...current.metrics, [metric.key]: text },
                      }));
                      setNotice("");
                    }}
                  />
                );
              })}
            </div>
            <SelectField
              label="Ressenti"
              name="feeling"
              value={draft.feeling}
              onChange={(event) => {
                update({ feeling: event.target.value });
              }}
            >
              <option value="">Non noté</option>
              {FEELINGS.map((f) => (
                <option key={f.value} value={String(f.value)}>
                  {f.label}
                </option>
              ))}
            </SelectField>
          </fieldset>
          <div role="alert" className="empty:hidden">
            {invalid.length > 0 && (
              <p className="text-danger font-semibold">
                {`${String(invalid.length)} ${invalid.length > 1 ? "champs à corriger" : "champ à corriger"} : ${faultNames(invalid)}.`}
              </p>
            )}
            {save.isError && (
              <p className="rounded-control border-danger text-danger border p-4 font-semibold">
                {ACTIVITY_NOT_SAVED}
              </p>
            )}
            {remove.isError && (
              <p className="rounded-control border-danger text-danger border p-4 font-semibold">
                {ACTIVITY_NOT_DELETED}
              </p>
            )}
          </div>
          {confirming ? (
            <div className="flex flex-col gap-3">
              <p className="font-semibold">
                {`Supprimer l’activité (${sport.label.toLowerCase()}, ${shortDay(draft.day)}) ?`}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="danger"
                  aria-disabled={remove.isPending}
                  onClick={() => {
                    if (remove.isPending) return;
                    const label = sport.label;
                    const day = draft.day;
                    remove.mutate(draft.id, {
                      onSuccess: () => {
                        reset(`Activité supprimée : ${label.toLowerCase()}, ${longDay(day)}.`);
                        focus("select[name=sport]");
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
                      setConfirming(false);
                    });
                    focus("[data-focus=delete]");
                  }}
                >
                  Garder
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                block
                disabled={!hydrated}
                aria-disabled={save.isPending}
              >
                {editing ? "Enregistrer les modifications" : "Enregistrer l’activité"}
              </Button>
              {editing && (
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const id = editingId;
                      save.reset();
                      reset("Modification annulée.");
                      if (id) focusRow(id);
                    }}
                  >
                    Annuler
                  </Button>
                  <Button
                    variant="danger"
                    data-focus="delete"
                    onClick={() => {
                      remove.reset();
                      flushSync(() => {
                        setConfirming(true);
                      });
                      focus("[data-focus=keep]");
                    }}
                  >
                    Supprimer
                  </Button>
                </div>
              )}
            </div>
          )}
        </form>
      )}
      <p aria-live="polite" className="text-ink-muted empty:sr-only">
        {notice}
      </p>

      <section
        aria-labelledby="history-title"
        aria-busy={activities.isPending}
        className="flex flex-col gap-4"
      >
        <h2 id="history-title" className="text-xl font-extrabold [font-stretch:112%]">
          {`${String(JOURNAL_DAYS)} derniers jours`}
        </h2>
        {activities.isPending && <p className="text-ink-muted">Chargement des activités…</p>}
        {activities.isError && (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="text-danger font-semibold">{ACTIVITIES_UNAVAILABLE}</p>
            <Button
              variant="secondary"
              onClick={() => {
                void activities.refetch();
              }}
            >
              Réessayer
            </Button>
          </div>
        )}
        {activities.isSuccess &&
          (rows.length === 0 ? (
            <p className="text-ink-muted">{NO_ACTIVITY}</p>
          ) : (
            <>
              <p className="font-semibold tabular-nums">{summaryText(rows)}</p>
              <ul
                ref={listRef}
                aria-label="Activités, les plus récentes d’abord"
                className="border-line-subtle border-t"
              >
                {rows.map((activity) => {
                  const label = sportLabel(activity.sport);
                  const current = editingId === activity.id;
                  const locked = editing && !current;
                  return (
                    <li
                      key={activity.id}
                      className="border-line-subtle flex items-center justify-between gap-3 border-b py-2"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="font-semibold">
                          {`${label}, `}
                          <time dateTime={activity.date}>{shortDay(activity.date)}</time>
                          {current && (
                            <span className="text-ink-muted font-normal">
                              {" (en cours de modification)"}
                            </span>
                          )}
                        </span>
                        <span className="text-ink-muted text-sm tabular-nums">
                          {detailText(
                            activity,
                            catalog.find((s) => s.key === activity.sport),
                            system,
                          )}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        data-activity={activity.id}
                        aria-label={`Modifier l’activité : ${label.toLowerCase()}, ${longDay(activity.date)}, ${durationText(activity.duration_s)}`}
                        // Une modification à la fois : la saisie en cours n'est jamais remplacée.
                        aria-disabled={locked}
                        onClick={() => {
                          if (!locked) startEdit(activity);
                        }}
                      >
                        Modifier
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </>
          ))}
      </section>
    </div>
  );
}
