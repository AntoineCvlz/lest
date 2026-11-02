import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchClient, type Schemas } from "@/shared/api/client";

import { PROGRAMS_KEY } from "./query-keys";
import { newId, WorkoutRequestFailed } from "./use-workout";

type Program = Schemas["ProgramDetailOut"];

/** Programmes du compte, avec séances types et exercices (peu nombreux, plafonnés). */
export function usePrograms() {
  return useQuery({
    queryKey: PROGRAMS_KEY,
    queryFn: async (): Promise<Program[]> => {
      const { data, response } = await fetchClient.GET("/api/v1/programs/");
      if (!data) throw new WorkoutRequestFailed(response.status);
      return data;
    },
    retry: false,
  });
}

/** Un programme, lu dans la liste (une seule requête pour la liste et le détail). */
export function useProgram(id: string) {
  const programs = usePrograms();
  return { ...programs, program: programs.data?.find((one) => one.id === id) ?? null };
}

/** Toute écriture de programme relit la liste : cibles, ordre et noms restent à jour. */
function useProgramWrite<Variables, Result>(write: (variables: Variables) => Promise<Result>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROGRAMS_KEY }),
  });
}

async function expect<T>(request: Promise<{ data?: T; response: Response }>): Promise<T> {
  const { data, response } = await request;
  if (data === undefined) throw new WorkoutRequestFailed(response.status);
  return data;
}

async function expectDeleted(request: Promise<{ response: Response }>): Promise<void> {
  const { response } = await request;
  if (response.status !== 204) throw new WorkoutRequestFailed(response.status);
}

export function useSaveProgram() {
  return useProgramWrite(({ id = newId(), name }: { id?: string; name: string }) =>
    expect(
      fetchClient.PUT("/api/v1/programs/{program_id}/", {
        params: { path: { program_id: id } },
        body: { name },
      }),
    ),
  );
}

export function useDeleteProgram() {
  return useProgramWrite((id: string) =>
    expectDeleted(
      fetchClient.DELETE("/api/v1/programs/{program_id}/", {
        params: { path: { program_id: id } },
      }),
    ),
  );
}

export function useSaveDay() {
  return useProgramWrite(
    ({
      id = newId(),
      programId,
      name,
      position,
    }: {
      id?: string;
      programId: string;
      name: string;
      position: number;
    }) =>
      expect(
        fetchClient.PUT("/api/v1/program-days/{day_id}/", {
          params: { path: { day_id: id } },
          body: { program_id: programId, name, position },
        }),
      ),
  );
}

export function useDeleteDay() {
  return useProgramWrite((id: string) =>
    expectDeleted(
      fetchClient.DELETE("/api/v1/program-days/{day_id}/", { params: { path: { day_id: id } } }),
    ),
  );
}

export interface PlannedExercise {
  id?: string;
  dayId: string;
  exerciseId: string;
  position: number;
  targetSets: number;
  targetReps: number;
}

export function useSavePlannedExercise() {
  return useProgramWrite(({ id = newId(), ...planned }: PlannedExercise) =>
    expect(
      fetchClient.PUT("/api/v1/program-exercises/{program_exercise_id}/", {
        params: { path: { program_exercise_id: id } },
        body: {
          day_id: planned.dayId,
          exercise_id: planned.exerciseId,
          position: planned.position,
          target_sets: planned.targetSets,
          target_reps: planned.targetReps,
        },
      }),
    ),
  );
}

export function useDeletePlannedExercise() {
  return useProgramWrite((id: string) =>
    expectDeleted(
      fetchClient.DELETE("/api/v1/program-exercises/{program_exercise_id}/", {
        params: { path: { program_exercise_id: id } },
      }),
    ),
  );
}

/** Position suivante dans une liste ordonnée (ajout à la fin). */
export function nextPosition(items: readonly { position: number }[]): number {
  return Math.max(-1, ...items.map((item) => item.position)) + 1;
}
