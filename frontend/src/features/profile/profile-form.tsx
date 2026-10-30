"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";

import { fetchClient, type Schemas } from "@/shared/api/client";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { metresToCentimetres, metresToFeetInches } from "@/shared/lib/units";
import { Button } from "@/shared/ui/button";
import { ChoiceGroup } from "@/shared/ui/choice-group";
import { TextField } from "@/shared/ui/text-field";

import {
  defaultsFrom,
  heightInMetres,
  profileFormSchema,
  toPayload,
  type ProfileFormValues,
} from "./profile-schema";

const GOAL_OPTIONS = [
  { value: "gain", label: "Prise de masse" },
  { value: "maintain", label: "Maintien" },
  { value: "cut", label: "Sèche" },
] as const;

const UNIT_OPTIONS = [
  { value: "metric", label: "kg, cm" },
  { value: "imperial", label: "lb, ft" },
] as const;

const FORMULA_OPTIONS = [
  { value: "epley", label: "Epley (par défaut)" },
  { value: "brzycki", label: "Brzycki" },
] as const;

export const SAVED = "Profil enregistré.";
const SESSION_EXPIRED = "Votre session a expiré : reconnectez-vous pour enregistrer.";
const NOT_SAVED = "Le profil n’a pas pu être enregistré. Réessayez dans un instant.";

async function saveProfile(values: ProfileFormValues): Promise<void> {
  const { response } = await fetchClient.PUT("/api/v1/me/profile/", { body: toPayload(values) });
  if (response.ok) return;
  throw new Error(response.status === 401 ? SESSION_EXPIRED : NOT_SAVED);
}

/**
 * Objectif, unités d'affichage et taille. Sert à l'onboarding (`redirectTo`) et à l'écran de
 * profil (message de confirmation sur place), qui propose aussi la formule du 1RM.
 */
export function ProfileForm({
  initial,
  submitLabel,
  redirectTo,
}: {
  initial?: Schemas["ProfileOut"];
  submitLabel: string;
  redirectTo?: Route;
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: defaultsFrom(initial),
  });
  const mutation = useMutation({
    mutationFn: saveProfile,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      if (redirectTo) router.push(redirectTo);
    },
  });
  const unitSystem = useWatch({ control: form.control, name: "unit_system" });
  const { errors } = form.formState;

  /** Change d'unités en convertissant la taille déjà saisie, pour ne pas la retaper. */
  function changeUnits(next: ProfileFormValues["unit_system"]) {
    const metres = heightInMetres(form.getValues());
    form.setValue("unit_system", next);
    if (metres === null) return;
    const { feet, inches } = metresToFeetInches(metres);
    form.setValue("height_cm", String(metresToCentimetres(metres)));
    form.setValue("feet", String(feet));
    form.setValue("inches", String(inches));
  }

  return (
    <form
      method="post"
      noValidate
      onSubmit={(event) => {
        void form.handleSubmit((values) => {
          mutation.mutate(values);
        })(event);
      }}
      className="flex flex-1 flex-col gap-8"
    >
      <Controller
        control={form.control}
        name="goal"
        render={({ field }) => (
          <div className="flex flex-col gap-2">
            <ChoiceGroup
              legend="Objectif"
              layout="column"
              options={GOAL_OPTIONS}
              value={field.value}
              onChange={field.onChange}
            />
            {errors.goal && (
              <p className="text-danger text-sm font-semibold">{errors.goal.message}</p>
            )}
          </div>
        )}
      />
      <ChoiceGroup
        legend="Unités"
        options={UNIT_OPTIONS}
        value={unitSystem}
        onChange={changeUnits}
      />
      {unitSystem === "metric" ? (
        <TextField
          label="Taille (cm)"
          inputMode="numeric"
          autoComplete="off"
          error={errors.height_cm?.message}
          {...form.register("height_cm")}
        />
      ) : (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="text-ink mb-2 p-0 font-semibold">Taille</legend>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Pieds"
              inputMode="numeric"
              autoComplete="off"
              error={errors.feet?.message}
              {...form.register("feet")}
            />
            <TextField
              label="Pouces"
              inputMode="numeric"
              autoComplete="off"
              {...form.register("inches")}
            />
          </div>
        </fieldset>
      )}
      {initial && (
        <Controller
          control={form.control}
          name="one_rm_formula"
          render={({ field }) => (
            <div className="flex flex-col gap-2">
              <ChoiceGroup
                legend="Formule du 1RM estimé"
                layout="column"
                options={FORMULA_OPTIONS}
                value={field.value}
                onChange={field.onChange}
              />
              <p className="text-ink-muted text-sm">
                Estime la charge maximale sur une répétition à partir d’une série : Epley jusqu’à 12
                répétitions, Brzycki jusqu’à 10. Changer de formule recalcule vos records.
              </p>
            </div>
          )}
        />
      )}
      <div role="alert" className="empty:hidden">
        {mutation.isError && (
          <p className="rounded-control border-danger text-danger border p-4 font-semibold">
            {mutation.error.message}
          </p>
        )}
      </div>
      <p role="status" className="text-ink font-semibold empty:hidden">
        {mutation.isSuccess && !redirectTo ? SAVED : ""}
      </p>
      <div className="mt-auto pt-4 sm:mt-2">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          disabled={!hydrated || mutation.isPending}
        >
          {mutation.isPending ? "Enregistrement…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
